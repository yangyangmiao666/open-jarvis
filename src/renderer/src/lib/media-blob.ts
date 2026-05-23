import { useEffect, useState } from "react";

/** Convert base64 file payload to an object URL; revoked on unmount. */
export function useObjectUrlFromBase64(
  base64: string | null,
  mimeType: string,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!base64) {
      setUrl(null);
      return undefined;
    }
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const u = URL.createObjectURL(blob);
      setUrl(u);
      return () => {
        URL.revokeObjectURL(u);
      };
    } catch {
      setUrl(null);
      return undefined;
    }
  }, [base64, mimeType]);

  return url;
}
