import { describe, expect, test } from "bun:test";
import { buildProgressMessage, formatCodexProgress } from "../src/main/services/telegram-progress";

describe("Telegram Codex progress", () => {
  test("renders commands and agent updates", () => {
    expect(formatCodexProgress({
      type: "item.started",
      item: { type: "command_execution", command: "bun test" },
    })).toContain("Running");
    expect(formatCodexProgress({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "bun test",
        aggregated_output: "20 pass\n0 fail",
        exit_code: 0,
      },
    })).toContain("20 pass");
    expect(formatCodexProgress({
      type: "item.completed",
      item: { type: "agent_message", text: "I fixed the bug." },
    })).toContain("I fixed the bug");
  });

  test("keeps one bounded rolling message with the latest progress", () => {
    const message = buildProgressMessage(
      "job_123",
      Array.from({ length: 20 }, (_, index) => `${index}: ${"x".repeat(500)}`),
    );

    expect(message.length).toBeLessThanOrEqual(3_200);
    expect(message).toContain("19:");
    expect(message).not.toContain("0:");
  });
});
