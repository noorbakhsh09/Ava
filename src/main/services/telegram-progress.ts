import type { CodexEvent } from "../clients/codex";

function compact(value: unknown, max = 700) {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\n{3,}/g, "\n\n");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function command(value: unknown) {
  return compact(value, 320).replace(/\s+/g, " ").replace(/`/g, "'");
}

export function formatCodexProgress(event: CodexEvent): string | undefined {
  if (event.type === "thread.started") return "🔗 Codex conversation connected.";
  if (event.type === "turn.completed") return "✅ Codex finished the turn.";
  const item = event.item;
  if (!item?.type) return;

  if (event.type === "item.started") {
    if (item.type === "command_execution") {
      return `▶️ Running: \`${command(item.command) || "command"}\``;
    }
    if (item.type === "mcp_tool_call") {
      return `🔧 Using tool: **${compact(item.name, 120) || "MCP tool"}**`;
    }
    if (item.type === "web_search") return "🔎 Searching the web…";
    return;
  }

  if (event.type !== "item.completed") return;
  if (item.type === "agent_message") {
    const text = compact(item.text);
    return text ? `💬 ${text}` : undefined;
  }
  if (item.type === "reasoning") {
    const text = compact(item.text);
    return text ? `🧠 ${text}` : undefined;
  }
  if (item.type === "command_execution") {
    const output = compact(item.aggregated_output, 500);
    const exit = typeof item.exit_code === "number" ? ` (exit ${item.exit_code})` : "";
    return [`⚙️ Finished: \`${command(item.command) || "command"}\`${exit}`, output].filter(Boolean).join("\n");
  }
  if (item.type === "file_change") return "📝 Applied file changes.";
  if (item.type === "mcp_tool_call") {
    return `🔧 Finished tool: **${compact(item.name, 120) || "MCP tool"}**`;
  }
  if (item.type === "web_search") return "🔎 Web search completed.";
  return;
}

export function buildProgressMessage(jobId: string, lines: string[]) {
  const header = `⏳ **Ava is working**\nJob: \`${jobId}\``;
  const kept: string[] = [];
  let size = header.length;
  for (const line of [...lines].reverse()) {
    if (size + line.length + 2 > 3_200) break;
    kept.unshift(line);
    size += line.length + 2;
  }
  return [header, ...kept].join("\n\n");
}
