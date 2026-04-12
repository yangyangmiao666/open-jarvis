import { memo } from "react"
import { Brain, ChevronDown } from "lucide-react"
import { StreamingMarkdown } from "./StreamingMarkdown"

interface ThinkAwareMarkdownProps {
  children: string
  isStreaming?: boolean
}

interface Segment {
  kind: "markdown" | "think"
  content: string
}

function parseThinkSegments(input: string, isStreaming: boolean): Segment[] {
  const segments: Segment[] = []
  const openTag = "<think>"
  const closeTag = "</think>"
  let cursor = 0

  while (cursor < input.length) {
    const start = input.indexOf(openTag, cursor)
    if (start === -1) {
      const tail = input.slice(cursor)
      if (tail) segments.push({ kind: "markdown", content: tail })
      break
    }

    const before = input.slice(cursor, start)
    if (before) segments.push({ kind: "markdown", content: before })

    const contentStart = start + openTag.length
    const end = input.indexOf(closeTag, contentStart)
    if (end === -1) {
      const thinkContent = input.slice(contentStart)
      if (thinkContent || isStreaming) {
        segments.push({ kind: "think", content: thinkContent })
      }
      break
    }

    const thinkContent = input.slice(contentStart, end)
    segments.push({ kind: "think", content: thinkContent })
    cursor = end + closeTag.length
  }

  return segments
}

export const ThinkAwareMarkdown = memo(function ThinkAwareMarkdown({
  children,
  isStreaming = false
}: ThinkAwareMarkdownProps): React.JSX.Element {
  const segments = parseThinkSegments(children, isStreaming)

  return (
    <div className="space-y-3">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1

        if (segment.kind === "think") {
          return (
            <details
              key={`think-${index}`}
              className="think-block rounded-sm border border-amber-500/25 bg-amber-500/[0.06]"
              open={isStreaming && isLast}
            >
              <summary className="think-summary">
                <span className="flex items-center gap-2">
                  <Brain className="size-3.5" strokeWidth={1.8} />
                  <span>{isStreaming && isLast ? "思考中" : "模型思考"}</span>
                </span>
                <ChevronDown className="think-chevron size-3.5" strokeWidth={1.8} />
              </summary>
              <div className="think-content">
                <StreamingMarkdown isStreaming={false}>{segment.content || "*思考内容为空*"}</StreamingMarkdown>
              </div>
            </details>
          )
        }

        return (
          <StreamingMarkdown key={`markdown-${index}`} isStreaming={isStreaming && isLast}>
            {segment.content}
          </StreamingMarkdown>
        )
      })}
    </div>
  )
})
