import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-primary shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
          : "bg-[var(--border-subtle)]",
        className
      )}
    >
      <span
        className={cn(
          "pointer-events-none block size-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-200",
          checked ? "translate-x-5 bg-white" : "translate-x-0 bg-[color-mix(in_srgb,#fff_90%,var(--border-muted))]"
        )}
      />
    </button>
  );
}