import { Input } from "@/components/ui/input";
import { LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from "react";

interface SettingsInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "title"> {
  label: string;
  description?: string;
  error?: string;
  endAdornment?: ReactNode;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function SettingsInput({
  label,
  description,
  error,
  endAdornment,
  className = "",
  id,
  ...inputProps
}: SettingsInputProps) {
  const inputId = id || label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className={LABEL_CLASS}>
            {label}
          </label>
          {description && <div className={DESCRIPTION_CLASS}>{description}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Input
            id={inputId}
            className={`h-9 w-[260px] ${error ? "border-destructive" : ""} ${className}`}
            {...inputProps}
          />
          {endAdornment}
        </div>
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
