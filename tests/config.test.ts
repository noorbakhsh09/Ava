import { describe, expect, test } from "bun:test";
import { assertAllowedWorkspace, postgresUrlHint, settingsSchema } from "../src/main/config";

describe("agent configuration", () => {
  test("accepts only an exact allowlisted workspace", () => {
    expect(assertAllowedWorkspace("/tmp/project", ["/tmp/project"])).toBe("/tmp/project");
    expect(() => assertAllowedWorkspace("/tmp/other", ["/tmp/project"])).toThrow("not allowlisted");
  });

  test("does not expose PostgreSQL credentials in its hint", () => {
    expect(postgresUrlHint("postgresql://user:secret@db.example.com:5432/ava")).toBe(
      "postgresql://db.example.com:5432/ava",
    );
  });

  test("rejects Telegram usernames as authorization IDs", () => {
    expect(() => settingsSchema.parse({ telegramAllowedUserIds: ["@someone"] })).toThrow();
  });

  test("uses public example values instead of a private Codex gateway", () => {
    const defaults = settingsSchema.parse({});
    expect(defaults.codexBaseUrl).toBe("https://codex-gateway.example.com/v1");
    expect(defaults.codexProvider).toBe("custom_gateway");
  });
});
