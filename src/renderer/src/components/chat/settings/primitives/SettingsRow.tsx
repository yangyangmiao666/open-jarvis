import { type ReactNode } from "react";
import { ROW_CLASS, LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";

interface SettingsRowProps {
  label: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SettingsRow({
  label,
  description,
  icon,
  children,
  className = "",
}: SettingsRowProps) {
  return (
    <div className={`${ROW_CLASS} ${className}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        {icon && (
          <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
        )}
        <div className="min-w-0">
          <div className={LABEL_CLASS}>{label}</div>
          {description && <div className={DESCRIPTION_CLASS}>{description}</div>}
        </div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
