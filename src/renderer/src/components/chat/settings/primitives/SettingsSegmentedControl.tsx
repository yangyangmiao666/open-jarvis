import { LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";

interface SettingsSegmentedControlProps {
  label?: string;
  description?: string;
  options: { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SettingsSegmentedControl({
  label,
  description,
  options,
  value,
  onValueChange,
  className = "",
}: SettingsSegmentedControlProps) {
  return (
    <div className={`px-4 py-3 ${className}`}>
      {(label || description) && (
        <div className="mb-2">
          {label && <div className={LABEL_CLASS}>{label}</div>}
          {description && <div className={DESCRIPTION_CLASS}>{description}</div>}
        </div>
      )}
      <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={
              `inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 ` +
              `text-sm font-medium ring-offset-background transition-all ` +
              `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ` +
              `focus-visible:ring-offset-2 ` +
              (value === opt.value
                ? "bg-background text-foreground shadow"
                : "hover:bg-background/50 hover:text-foreground")
            }
            onClick={() => onValueChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
