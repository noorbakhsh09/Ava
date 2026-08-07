import { describe, expect, test } from "bun:test";
import { CodexClient } from "../src/main/clients/codex";
import type { RunCommandOptions } from "../src/main/services/command-runner";

const config = {
  postgresUrl: "",
  telegramBotToken: "",
  telegramAllowedUserIds: new Set<string>(),
  workspaces: ["/tmp/projects", "/tmp/other-projects"],
  codexBin: "codex",
  codexBaseUrl: "https://example.test",
  codexAuthToken: "codex_secret",
  codexModelProvider: "custom_gateway",
  githubBin: "gh",
  githubToken: "github_secret",
  codexTimeoutMs: 1_000,
  localApiPort: 3421,
  localApiToken: "test",
};

describe("Codex GitHub job configuration", () => {
  test("enables Git metadata, network, and the narrow GitHub environment", async () => {
    let codexArgs: string[] = [];
    let codexEnvironment: NodeJS.ProcessEnv = {};
    const runner = async (command: string, args: string[], options: RunCommandOptions = {}) => {
      if (command === "git") {
        return { stdout: "/tmp/project/.git\n", stderr: "", exitCode: 0 };
      }

      codexArgs = args;
      codexEnvironment = options.env ?? {};
      await options.onStdoutLine?.(JSON.stringify({ type: "thread.started", thread_id: "thread_123" }));
      await options.onStdoutLine?.(
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done" } }),
      );
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const client = new CodexClient(config, runner);

    const result = await client.run("Open a PR", "/tmp/projects", undefined, {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      githubAccess: true,
      skipGitRepoCheck: true,
      additionalWritableDirectories: config.workspaces,
      resumeThreadId: "thread_existing",
    });

    expect(result).toEqual({ threadId: "thread_123", finalMessage: "Done" });
    expect(codexArgs).toContain("/tmp/project/.git");
    expect(codexArgs).toContain("--skip-git-repo-check");
    expect(codexArgs).toContain("/tmp/other-projects");
    expect(codexArgs).toContain("sandbox_workspace_write.network_access=true");
    expect(codexArgs).toContain("shell_environment_policy.ignore_default_excludes=true");
    expect(codexArgs.slice(-3)).toEqual(["resume", "thread_existing", "-"]);
    expect(codexArgs.some((arg) => arg.includes('"GH_TOKEN"'))).toBe(true);
    expect(codexEnvironment.GH_TOKEN).toBe("github_secret");
    expect(codexEnvironment.GITHUB_TOKEN).toBe("github_secret");
    expect(codexEnvironment.OPENAI_API_KEY).toBe("codex_secret");
  });
});
