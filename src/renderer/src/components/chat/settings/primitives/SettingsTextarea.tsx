import { LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";

interface SettingsTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "title"> {
  label: string;
  description?: string;
  error?: string;
}

export function SettingsTextarea({
  label,
  description,
  error,
  className = "",
  id,
  ...textareaProps
}: SettingsTextareaProps) {
  const textareaId = id || label.replace(/\s+/g, "-").toLowerCase();

  return (
    <div className="px-4 py-3">
      <label htmlFor={textareaId} className={`${LABEL_CLASS} block mb-1.5`}>
        {label}
      </label>
      {description && <div className={`${DESCRIPTION_CLASS} mb-1.5`}>{description}</div>}
      <textarea
        id={textareaId}
        className={
          `flex min-h-[80px] w-full rounded-lg border border-input app-premium-field px-3 py-2 text-sm ` +
          `ring-offset-background placeholder:text-muted-foreground ` +
          `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 ` +
          `focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ` +
          `${error ? "border-destructive" : ""} ${className}`
        }
        {...textareaProps}
      />
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
