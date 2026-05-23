import { type ReactNode } from "react";
import { SECTION_TITLE_CLASS, SECTION_DESCRIPTION_CLASS } from "./SettingsUIConstants";

interface SettingsSectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className = "",
}: SettingsSectionProps) {
  return (
    <div className={`mb-6 ${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
          {description && (
            <p className={SECTION_DESCRIPTION_CLASS}>{description}</p>
          )}
        </div>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      {children}
    </div>
  );
}
