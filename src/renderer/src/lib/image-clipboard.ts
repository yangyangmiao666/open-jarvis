import { toast } from "@/lib/toast";
import i18n from "@/lib/locales";

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to convert image to data URL"));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read image blob"));
    };
    reader.readAsDataURL(blob);
  });
}

export function buildDataUrlFromBase64(
  base64: string,
  mimeType: string,
): string {
  return `data:${mimeType};base64,${base64}`;
}

export async function copyImageDataUrlToClipboard(
  dataUrl: string,
): Promise<boolean> {
  try {
    const result = await window.api.settings.writeImageToClipboard({ dataUrl });
    if (!result.success) {
      throw new Error(result.error || "Copy failed");
    }
    toast.success(i18n.t("common:toast.copiedToClipboard"));
    return true;
  } catch (error) {
    console.error("[image-clipboard] Failed to copy image:", error);
    toast.error(i18n.t("common:toast.copyFailed"));
    return false;
  }
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<boolean> {
  const dataUrl = await blobToDataUrl(blob);
  return await copyImageDataUrlToClipboard(dataUrl);
}

export async function copyImageUrlToClipboard(url: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load image: ${response.status}`);
  }
  const blob = await response.blob();
  return await copyImageBlobToClipboard(blob);
}
