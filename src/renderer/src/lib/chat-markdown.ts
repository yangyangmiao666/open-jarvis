import type { Message } from "@/types"

function stringifyContent(m: Message): string {
  if (typeof m.content === "string") return m.content
  if (!Array.isArray(m.content)) return ""
  return m.content
    .filter((b): b is { type: "text"; text?: string } => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
}

function formatToolResultBody(content: unknown): string {
  if (typeof content === "string") return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

/** 单条气泡导出为 Markdown（与列表视图一致：含工具调用；可选附带工具结果） */
export function singleMessageToMarkdown(
  message: Message,
  toolResults?: Map<string, { content: unknown; is_error?: boolean }>
): string {
  if (message.role === "tool" || message.role === "system") return ""
  if (message.role === "user") {
    const t = stringifyContent(message).trim()
    return `## 你\n\n${t}`.trim()
  }
  if (message.role === "assistant") {
    const parts: string[] = ["## Jarvis"]
    const t = stringifyContent(message).trim()
    if (t) {
      parts.push("", t)
    }
    if (message.tool_calls?.length) {
      for (const tc of message.tool_calls) {
        parts.push("", `**工具** \`${tc.name}\``, "", "```json", JSON.stringify(tc.args, null, 2), "```")
        const res = toolResults?.get(tc.id)
        if (res !== undefined) {
          parts.push("", "**结果**", "", "```", formatToolResultBody(res.content), "```")
        }
      }
    }
    return parts.join("\n").trim()
  }
  return ""
}

/** 导出当前会话全部可见消息为 Markdown（与单条复制格式一致；可附带工具结果） */
export function messagesToMarkdown(
  messages: Message[],
  toolResults?: Map<string, { content: unknown; is_error?: boolean }>
): string {
  const blocks: string[] = []
  for (const m of messages) {
    const piece = singleMessageToMarkdown(m, toolResults)
    if (piece) blocks.push(piece)
  }
  return blocks.join("\n\n").trim()
}
