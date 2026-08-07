import { describe, expect, test } from "bun:test";
import { chunkMarkdown, markdownToTelegramHtml } from "../src/main/services/telegram-markdown";

describe("Telegram Markdown rendering", () => {
  test("renders common agent Markdown as Telegram HTML", () => {
    const html = markdownToTelegramHtml(
      "The app uses **TypeScript**.\n\n- **React** for UI\n- `Prisma` for data",
    );
    expect(html).toContain("<b>TypeScript</b>");
    expect(html).toContain("• <b>React</b> for UI");
    expect(html).toContain("<code>Prisma</code>");
    expect(html).not.toContain("**");
  });

  test("escapes raw HTML from model output", () => {
    expect(markdownToTelegramHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("keeps source chunks below the conservative Telegram limit", () => {
    expect(chunkMarkdown("x".repeat(6_000)).every((part) => part.length <= 2_800)).toBe(true);
  });
});
