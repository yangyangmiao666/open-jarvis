import { useId } from "react";
import { cn } from "@/lib/utils";

interface JarvisMarkProps {
  className?: string;
}

export function JarvisMark({ className }: JarvisMarkProps): React.JSX.Element {
  const gradientId = useId();
  const glowId = useId();

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-6", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="14" y1="12" x2="50" y2="52">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.98" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.92" />
        </linearGradient>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="18" fill={`url(#${glowId})`} />
      <path
        d="M32 14.5C40.6 14.5 47.5 21.6 47.5 30.4V33.8C47.5 42.8 40.3 50 31.5 50C22.7 50 16.5 42.8 16.5 33.8V30.4C16.5 21.6 23.4 14.5 32 14.5Z"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M22 28C24.8 23.7 28.8 21.5 34 21.5C38.2 21.5 41.9 23.1 45 26.5"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M24.5 17.8C26.8 14.9 29.5 13.5 32.5 13.5C35.7 13.5 38.6 14.9 41.2 17.8"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.3"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        d="M26.2 32.2C27.4 31 28.5 30.4 29.8 30.4C31.1 30.4 32.2 31 33.4 32.2"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M30.6 32.2C31.8 31 32.9 30.4 34.2 30.4C35.5 30.4 36.6 31 37.8 32.2"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M32 33.2V38.2"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M27.5 41.8C29 43.5 30.5 44.3 32 44.3C33.5 44.3 35 43.5 36.5 41.8"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="27.8" cy="30.8" r="1.2" fill="currentColor" fillOpacity="0.9" />
      <circle cx="36.2" cy="30.8" r="1.2" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}