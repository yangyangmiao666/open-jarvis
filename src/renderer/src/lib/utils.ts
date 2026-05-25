import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import i18n from "@/lib/locales";
import { useAppStore } from "@/lib/store";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(useAppStore.getState().language, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 文件列表等需要完整年月日时分的时间展示 */
export function formatDateTimeWithYear(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(useAppStore.getState().language, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return i18n.t("common:relativeTime.justNow");
  if (minutes < 60) return i18n.t("common:relativeTime.minutesAgo", { count: minutes });
  if (hours < 24) return i18n.t("common:relativeTime.hoursAgo", { count: hours });
  if (days < 7) return i18n.t("common:relativeTime.daysAgo", { count: days });

  return formatDate(d);
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "...";
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function normalizeLocalFilePath(rawPath: string): string {
  if (!rawPath) {
    return rawPath;
  }

  if (/^(https?:|data:|blob:|mailto:|#)/i.test(rawPath)) {
    return rawPath;
  }

  if (rawPath.startsWith("file://")) {
    try {
      const url = new URL(rawPath);
      return decodeURIComponent(url.pathname);
    } catch {
      return rawPath;
    }
  }

  if (!rawPath.includes("%")) {
    return rawPath;
  }

  try {
    return decodeURI(rawPath);
  } catch {
    return rawPath;
  }
}
