import { spawn } from "node:child_process";

export class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly stdout: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  onStdoutLine?: (line: string) => void | Promise<void>;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let outputBytes = 0;
    let timedOut = false;
    let lineCallbacks = Promise.resolve();

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGTERM");
        return;
      }
      const text = chunk.toString("utf8");
      stdout += text;
      pendingLine += text;
      const lines = pendingLine.split("\n");
      pendingLine = lines.pop() ?? "";
      for (const line of lines) {
        if (line && options.onStdoutLine) {
          lineCallbacks = lineCallbacks.then(() => options.onStdoutLine?.(line));
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      stderr += chunk.toString("utf8");
      if (outputBytes > maxOutputBytes) child.kill("SIGTERM");
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on("close", async (code) => {
      if (timer) clearTimeout(timer);
      if (pendingLine && options.onStdoutLine) {
        lineCallbacks = lineCallbacks.then(() => options.onStdoutLine?.(pendingLine));
      }
      await lineCallbacks;

      if (timedOut) {
        reject(new CommandError(`Command timed out after ${options.timeoutMs}ms`, code, stderr, stdout));
      } else if (outputBytes > maxOutputBytes) {
        reject(new CommandError("Command exceeded its output limit", code, stderr, stdout));
      } else if (code !== 0) {
        reject(new CommandError(`Command exited with code ${code}`, code, stderr, stdout));
      } else {
        resolve({ stdout, stderr, exitCode: code });
      }
    });

    child.stdin.end(options.input ?? "");
  });
}
