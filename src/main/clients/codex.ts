import type { RuntimeConfig } from "../config";
import { runCommand } from "../services/command-runner";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CodexResult {
  threadId?: string;
  finalMessage: string;
}

export type CodexEvent = Record<string, unknown> & {
  type?: string;
  thread_id?: string;
  item?: Record<string, unknown> & {
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    status?: string;
    exit_code?: number;
  };
};

interface CodexRunOptions {
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  sandbox?: "read-only" | "workspace-write";
  ephemeral?: boolean;
  skipGitRepoCheck?: boolean;
  outputSchemaPath?: string;
  timeoutMs?: number;
  ignoreUserConfig?: boolean;
  ignoreRules?: boolean;
  githubAccess?: boolean;
  resumeThreadId?: string;
  additionalWritableDirectories?: string[];
}

export class CodexClient {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly runner: typeof runCommand = runCommand,
  ) {}

  private async gitWritableDirectories(workspacePath: string): Promise<string[]> {
    try {
      const result = await this.runner(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
        { cwd: workspacePath, timeoutMs: 10_000, maxOutputBytes: 64 * 1024 },
      );
      return [...new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean))];
    } catch {
      return [];
    }
  }

  private providerArgs() {
    const provider = this.config.codexModelProvider;
    return [
      "--config",
      `model_provider=${JSON.stringify(provider)}`,
      "--config",
      `model_providers.${provider}.name=\"openai\"`,
      "--config",
      `model_providers.${provider}.base_url=${JSON.stringify(this.config.codexBaseUrl)}`,
      "--config",
      `model_providers.${provider}.wire_api=\"responses\"`,
      "--config",
      `model_providers.${provider}.supports_websockets=true`,
      "--config",
      `model_providers.${provider}.requires_openai_auth=true`,
    ];
  }

  private commandEnvironment(includeGitHub = false) {
    return {
      ...process.env,
      ...(this.config.codexAuthToken
        ? { OPENAI_API_KEY: this.config.codexAuthToken }
        : {}),
      ...(includeGitHub && this.config.githubToken
        ? { GH_TOKEN: this.config.githubToken, GITHUB_TOKEN: this.config.githubToken }
        : {}),
    };
  }

  async probe(workspacePath: string) {
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--json",
      "--color",
      "never",
      "--sandbox",
      "read-only",
      "--cd",
      workspacePath,
      ...this.providerArgs(),
      "Reply with exactly AVA_OK and do not use tools.",
    ];
    const result = await this.runner(this.config.codexBin, args, {
      cwd: workspacePath,
      env: this.commandEnvironment(),
      timeoutMs: 60_000,
      maxOutputBytes: 2 * 1024 * 1024,
    });
    if (!result.stdout.includes("AVA_OK")) throw new Error("Codex LB responded without the expected health marker");
  }

  async run(
    prompt: string,
    workspacePath: string,
    onEvent?: (event: CodexEvent) => void | Promise<void>,
    options: CodexRunOptions = {},
  ): Promise<CodexResult> {
    const gitWritableDirectories = options.githubAccess
      ? await this.gitWritableDirectories(workspacePath)
      : [];
    const additionalWritableDirectories = [
      ...new Set(
        [...(options.additionalWritableDirectories ?? []), ...gitWritableDirectories]
          .filter((directory) => directory !== workspacePath),
      ),
    ];
    const args = [
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      options.sandbox ?? "workspace-write",
      "--cd",
      workspacePath,
    ];

    for (const directory of additionalWritableDirectories) args.push("--add-dir", directory);

    if (options.ephemeral) args.push("--ephemeral");
    if (options.skipGitRepoCheck) args.push("--skip-git-repo-check");
    if (options.ignoreUserConfig) args.push("--ignore-user-config");
    if (options.ignoreRules) args.push("--ignore-rules");
    if (options.model) args.push("--model", options.model);
    if (options.reasoningEffort) {
      args.push("--config", `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`);
    }
    if (options.githubAccess) {
      args.push("--config", "sandbox_workspace_write.network_access=true");
      args.push("--config", 'shell_environment_policy.inherit="all"');
      args.push("--config", "shell_environment_policy.ignore_default_excludes=true");
      args.push(
        "--config",
        `shell_environment_policy.include_only=${JSON.stringify([
          "PATH",
          "HOME",
          "USER",
          "SHELL",
          "TMPDIR",
          "LANG",
          "LC_ALL",
          "SSH_AUTH_SOCK",
          "GH_TOKEN",
          "GITHUB_TOKEN",
        ])}`,
      );
    }
    if (options.outputSchemaPath) args.push("--output-schema", options.outputSchemaPath);
    args.push(...this.providerArgs());
    if (options.resumeThreadId) args.push("resume", options.resumeThreadId);
    args.push("-");

    let threadId: string | undefined;
    let finalMessage = "";

    await this.runner(this.config.codexBin, args, {
      cwd: workspacePath,
      env: this.commandEnvironment(options.githubAccess),
      input: prompt,
      timeoutMs: options.timeoutMs ?? this.config.codexTimeoutMs,
      maxOutputBytes: 25 * 1024 * 1024,
      onStdoutLine: async (line) => {
        let event: CodexEvent;
        try {
          event = JSON.parse(line) as CodexEvent;
        } catch {
          return;
        }

        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          threadId = event.thread_id;
        }
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          finalMessage = event.item.text ?? finalMessage;
        }
        await onEvent?.(event);
      },
    });

    return { threadId, finalMessage: finalMessage || "Codex completed without a final text message." };
  }

  async runStructured<T>(
    prompt: string,
    workspacePath: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const directory = await mkdtemp(join(tmpdir(), "ava-chat-schema-"));
    const schemaPath = join(directory, "response.schema.json");
    await writeFile(schemaPath, JSON.stringify(schema), "utf8");

    try {
      const result = await this.run(prompt, workspacePath, undefined, {
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
        sandbox: "read-only",
        ephemeral: true,
        skipGitRepoCheck: true,
        outputSchemaPath: schemaPath,
        timeoutMs: 180_000,
        ignoreUserConfig: true,
        ignoreRules: true,
      });
      const json = result.finalMessage
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      return JSON.parse(json) as T;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
