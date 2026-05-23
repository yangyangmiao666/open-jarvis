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
        "group relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200",
        "border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-primary border-primary shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
          : "bg-background-elevated border-border",
        className
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-[18px] w-[18px] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-200",
          checked ? "translate-x-[18px] bg-white" : "translate-x-[2px] bg-[var(--foreground)]"
        )}
      />
    </button>
  );
}