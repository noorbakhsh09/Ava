const MAX_SOURCE_CHUNK = 2_800;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToTelegramHtml(markdown: string): string {
  const protectedValues: string[] = [];
  const protect = (html: string) => {
    const token = `@@AVA${protectedValues.length}TOKEN@@`;
    protectedValues.push(html);
    return token;
  };

  let text = markdown.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_match, code: string) =>
    protect(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`),
  );
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) =>
    protect(`<code>${escapeHtml(code)}</code>`),
  );
  text = escapeHtml(text);

  text = text
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/^\s*[-+*]\s+(.+)$/gm, "• $1")
    .replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");

  protectedValues.forEach((html, index) => {
    text = text.replace(`@@AVA${index}TOKEN@@`, html);
  });
  return text.trim() || "(empty)";
}

export function chunkMarkdown(markdown: string): string[] {
  if (!markdown) return ["(empty)"];
  const chunks: string[] = [];
  let current = "";

  for (const line of markdown.split("\n")) {
    if (line.length > MAX_SOURCE_CHUNK) {
      if (current) chunks.push(current);
      for (let offset = 0; offset < line.length; offset += MAX_SOURCE_CHUNK) {
        chunks.push(line.slice(offset, offset + MAX_SOURCE_CHUNK));
      }
      current = "";
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MAX_SOURCE_CHUNK) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : ["(empty)"];
}
