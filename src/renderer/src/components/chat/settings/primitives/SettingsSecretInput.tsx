import { useState } from "react";
import { Input } from "@/components/ui/input";
import { LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";
import { Eye, EyeOff } from "lucide-react";
import type { ChangeEvent, InputHTMLAttributes } from "react";

interface SettingsSecretInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "title" | "type"> {
  label: string;
  description?: string;
  error?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

export function SettingsSecretInput({
  label,
  description,
  error,
  className = "",
  id,
  ...inputProps
}: SettingsSecretInputProps) {
  const [visible, setVisible] = useState(false);
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
        <div className="relative shrink-0">
          <Input
            id={inputId}
            type={visible ? "text" : "password"}
            className={`h-9 w-[260px] pr-9 ${error ? "border-destructive" : ""} ${className}`}
            {...inputProps}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setVisible((v) => !v)}
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}