import type { RuntimeConfig } from "../config";
import { runCommand } from "../services/command-runner";

export function githubEnvironment(
  token: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!token) return { ...base };
  return { ...base, GH_TOKEN: token, GITHUB_TOKEN: token };
}

export class GitHubClient {
  constructor(private readonly config: RuntimeConfig) {}

  async probe(): Promise<string> {
    let version: string;
    try {
      const result = await runCommand(this.config.githubBin, ["--version"], { timeoutMs: 10_000 });
      version = result.stdout.split("\n")[0]?.trim() || "GitHub CLI";
    } catch {
      throw new Error("GitHub CLI (gh) was not found. Install it with: brew install gh");
    }

    try {
      await runCommand(
        this.config.githubBin,
        ["auth", "status", "--active", "--hostname", "github.com"],
        {
          env: githubEnvironment(this.config.githubToken),
          timeoutMs: 20_000,
          maxOutputBytes: 512 * 1024,
        },
      );
    } catch {
      throw new Error(
        `${version} is installed, but GitHub authentication failed. Add a valid token or run gh auth login.`,
      );
    }

    return `${version} · authenticated with github.com`;
  }
}
