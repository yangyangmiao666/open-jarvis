import { defaultUrlTransform } from "react-markdown";

function decodeUrlPath(url: string): string {
  if (!url.includes("%")) {
    return url;
  }

  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function isLocalFileReference(url: string): boolean {
  const decoded = decodeUrlPath(url.trim());

  return (
    /^[A-Za-z]:[\\/]/.test(decoded) ||
    /^\\\\/.test(decoded) ||
    decoded.startsWith("/") ||
    decoded.startsWith("file://")
  );
}

/**
 * react-markdown's defaultUrlTransform treats `C:` as an unsafe URL scheme and
 * strips Windows absolute paths from img src / link href. Allow workspace-local
 * file references while keeping the default sanitizer for everything else.
 */
export function markdownUrlTransform(url: string): string {
  if (isLocalFileReference(url)) {
    return decodeUrlPath(url.trim());
  }

  return defaultUrlTransform(url);
}
