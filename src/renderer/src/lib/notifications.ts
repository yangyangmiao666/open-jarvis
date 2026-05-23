/**
 * Desktop notification state and sound playback
 *
 * Manages notification/sound preferences (localStorage-based),
 * provides playNotificationSound and sendDesktopNotification utilities.
 */

import soundDing from "@/assets/sound/ding.mp3"
import soundDingDong from "@/assets/sound/ding-dong.mp3"
import soundDiscord from "@/assets/sound/discord.mp3"
import soundDone from "@/assets/sound/done.mp3"
import soundDownPower from "@/assets/sound/down-power.mp3"
import soundFood from "@/assets/sound/food.mp3"
import soundLite from "@/assets/sound/lite.mp3"
import soundQuiet from "@/assets/sound/quiet.mp3"

// ===== Types =====

export type NotificationSoundId = "ding" | "ding-dong" | "discord" | "done" | "down-power" | "food" | "lite" | "quiet" | "none"
export type NotificationSoundType = "taskComplete" | "permissionRequest"
export type NotificationSoundSettings = Partial<Record<NotificationSoundType, NotificationSoundId>>

// ===== Sound registry =====

export interface NotificationSoundMeta {
  id: NotificationSoundId
  label: string
  url: string
}

export const NOTIFICATION_SOUNDS: NotificationSoundMeta[] = [
  { id: "ding", label: "Ding", url: soundDing },
  { id: "ding-dong", label: "Ding Dong", url: soundDingDong },
  { id: "discord", label: "Discord", url: soundDiscord },
  { id: "done", label: "Done", url: soundDone },
  { id: "down-power", label: "Down Power", url: soundDownPower },
  { id: "food", label: "Food", url: soundFood },
  { id: "lite", label: "Lite", url: soundLite },
  { id: "quiet", label: "Quiet", url: soundQuiet },
]

const SOUND_URL_MAP: Record<string, string> = Object.fromEntries(
  NOTIFICATION_SOUNDS.map((s) => [s.id, s.url]),
)

export const DEFAULT_NOTIFICATION_SOUNDS: Required<NotificationSoundSettings> = {
  taskComplete: "discord",
  permissionRequest: "lite",
}

// ===== localStorage helpers =====

const LS_NOTIFICATIONS_ENABLED = "openwork-notifications-enabled"
const LS_SOUND_ENABLED = "openwork-notification-sound-enabled"
const LS_NOTIFICATION_SOUNDS = "openwork-notification-sounds"

export function loadNotificationsEnabled(): boolean {
  const raw = localStorage.getItem(LS_NOTIFICATIONS_ENABLED)
  return raw === null ? true : raw === "true"
}

export function saveNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(LS_NOTIFICATIONS_ENABLED, String(enabled))
}

export function loadNotificationSoundEnabled(): boolean {
  const raw = localStorage.getItem(LS_SOUND_ENABLED)
  return raw === null ? true : raw === "true"
}

export function saveNotificationSoundEnabled(enabled: boolean): void {
  localStorage.setItem(LS_SOUND_ENABLED, String(enabled))
}

export function loadNotificationSounds(): NotificationSoundSettings {
  try {
    const raw = localStorage.getItem(LS_NOTIFICATION_SOUNDS)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function saveNotificationSounds(sounds: NotificationSoundSettings): void {
  localStorage.setItem(LS_NOTIFICATION_SOUNDS, JSON.stringify(sounds))
}

export async function ensureDesktopNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") {
    return "unsupported"
  }

  if (window.Notification.permission === "granted") {
    return "granted"
  }

  if (window.Notification.permission === "denied") {
    return "denied"
  }

  try {
    return await window.Notification.requestPermission()
  } catch {
    return "unsupported"
  }
}

// ===== Audio playback =====

const audioCache = new Map<string, HTMLAudioElement>()

function getAudioElement(soundId: NotificationSoundId): HTMLAudioElement | null {
  if (soundId === "none") return null
  const url = SOUND_URL_MAP[soundId]
  if (!url) return null

  let audio = audioCache.get(soundId)
  if (!audio) {
    audio = new Audio(url)
    audioCache.set(soundId, audio)
  }
  return audio
}

export function playNotificationSound(soundId: NotificationSoundId): void {
  try {
    const audio = getAudioElement(soundId)
    if (!audio) return
    audio.currentTime = 0
    audio.play().catch(() => {})
  } catch {
    // silent fail
  }
}

export function playNotificationSoundForType(
  type: NotificationSoundType,
  sounds: NotificationSoundSettings,
): void {
  const soundId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type]
  playNotificationSound(soundId)
}

// ===== Desktop notification =====

export interface DesktopNotificationOptions {
  soundType?: NotificationSoundType
  playSound?: boolean
  sounds?: NotificationSoundSettings
  soundEnabled?: boolean
  notificationsEnabled?: boolean
  onNavigate?: () => void
  force?: boolean
}

export function sendDesktopNotification(
  title: string,
  body: string,
  options?: DesktopNotificationOptions,
): void {
  setTimeout(async () => {
    if (options?.playSound && options.soundType && options.soundEnabled !== false) {
      playNotificationSoundForType(options.soundType, options.sounds ?? {})
    }

    if (options?.notificationsEnabled === false) return
    if (!options?.force && document.hasFocus()) return

    const permission = await ensureDesktopNotificationPermission()
    if (permission === "granted" && typeof window.Notification !== "undefined") {
      try {
        const notification = new window.Notification(title, { body, silent: true })
        notification.onclick = () => {
          window.focus()
          options?.onNavigate?.()
        }
        return
      } catch {
        // Fallback to Electron main process notification below
      }
    }

    void window.api.settings
      .showDesktopNotification({ title, body })
      .then(() => {})
      .catch(() => {
        // Native desktop notification may not be available
      })
  }, 0)
}