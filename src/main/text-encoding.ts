import iconv from "iconv-lite"

function toWellFormedText(value: string): string {
  if (typeof value.toWellFormed === "function") {
    return value.toWellFormed()
  }
  return value.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "\uFFFD"
  )
}

/**
 * Decode file bytes for display in the UI. Prefer UTF-8; if decoding produced
 * replacement characters (invalid UTF-8), fall back to GB18030 (common on Chinese Windows).
 */
export function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8")
  if (!utf8.includes("\uFFFD")) {
    return toWellFormedText(utf8)
  }
  try {
    return toWellFormedText(iconv.decode(buffer, "gb18030"))
  } catch {
    return toWellFormedText(utf8)
  }
}
