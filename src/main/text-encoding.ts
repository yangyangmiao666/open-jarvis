import iconv from "iconv-lite"

/**
 * Decode file bytes for display in the UI. Prefer UTF-8; if decoding produced
 * replacement characters (invalid UTF-8), fall back to GB18030 (common on Chinese Windows).
 */
export function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8")
  if (!utf8.includes("\uFFFD")) {
    return utf8
  }
  try {
    return iconv.decode(buffer, "gb18030")
  } catch {
    return utf8
  }
}
