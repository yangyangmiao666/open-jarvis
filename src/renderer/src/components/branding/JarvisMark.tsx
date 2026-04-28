import { useId } from "react";
import { cn } from "@/lib/utils";

interface JarvisMarkProps {
  className?: string;
}

export function JarvisMark({ className }: JarvisMarkProps): React.JSX.Element {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-6", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="60" y2="60">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.98" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.92" />
        </linearGradient>
      </defs>

      {/* 8-pointed star - Gemini style */}
      {/* Outer star points - alternating long and short */}
      <path
        d="M32 2L35.5 22L56 8L40 26L62 32L40 38L56 56L35.5 42L32 62L28.5 42L8 56L24 38L2 32L24 26L8 8L28.5 22Z"
        fill={`url(#${gradientId})`}
        fillOpacity="0.15"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Inner 4-pointed star highlight */}
      <path
        d="M32 12L38 28L54 32L38 36L32 52L26 36L10 32L26 28Z"
        fill={`url(#${gradientId})`}
        fillOpacity="0.35"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Center glow circle */}
      <circle cx="32" cy="32" r="5" fill={`url(#${gradientId})`} fillOpacity="0.7" />
      <circle cx="32" cy="32" r="2.5" fill="currentColor" />
    </svg>
  );
}
