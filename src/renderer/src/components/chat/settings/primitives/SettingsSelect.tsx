import { LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";

interface SettingsSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "title"> {
  label: string;
  description?: string;
  options: { value: string; label: string }[];
}

export function SettingsSelect({
  label,
  description,
  options,
  className = "",
  id,
  ...selectProps
}: SettingsSelectProps) {
  const selectId = id || label.replace(/\s+/g, "-").toLowerCase();

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={selectId} className={LABEL_CLASS}>
            {label}
          </label>
          {description && <div className={DESCRIPTION_CLASS}>{description}</div>}
        </div>
        <select
          id={selectId}
          className={
            `flex h-9 w-[260px] rounded-lg border border-input bg-background px-3 text-sm ` +
            `ring-offset-background focus-visible:outline-none focus-visible:ring-2 ` +
            `focus-visible:ring-ring focus-visible:ring-offset-2 ` +
            `disabled:cursor-not-allowed disabled:opacity-50 ${className}`
          }
          {...selectProps}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
