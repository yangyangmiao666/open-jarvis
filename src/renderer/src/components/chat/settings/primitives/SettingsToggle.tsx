import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "./SettingsRow";
import type { ReactNode } from "react";

interface SettingsToggleProps {
  label: string;
  description?: string;
  icon?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function SettingsToggle({
  label,
  description,
  icon,
  checked,
  onCheckedChange,
  disabled = false,
  className = "",
}: SettingsToggleProps) {
  return (
    <SettingsRow label={label} description={description} icon={icon} className={className}>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </SettingsRow>
  );
}
