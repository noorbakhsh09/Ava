import { describe, expect, test } from "bun:test";
import { githubEnvironment } from "../src/main/clients/github";

describe("GitHub CLI environment", () => {
  test("passes a configured token under the standard gh variable names", () => {
    const environment = githubEnvironment("github_secret", { PATH: "/usr/bin" });

    expect(environment.PATH).toBe("/usr/bin");
    expect(environment.GH_TOKEN).toBe("github_secret");
    expect(environment.GITHUB_TOKEN).toBe("github_secret");
  });

  test("does not add empty token variables", () => {
    const environment = githubEnvironment("", { PATH: "/usr/bin" });

    expect(environment.GH_TOKEN).toBeUndefined();
    expect(environment.GITHUB_TOKEN).toBeUndefined();
  });
});
