import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LABEL_CLASS, DESCRIPTION_CLASS } from "./SettingsUIConstants";

interface SettingsSelectProps {
  label: string;
  description?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SettingsSelect({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder,
  disabled = false,
  className = "",
}: SettingsSelectProps) {
  return (
    <div className={`px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className={LABEL_CLASS}>{label}</div>
          {description && <div className={DESCRIPTION_CLASS}>{description}</div>}
        </div>
        <Select value={value} onValueChange={onValueChange} disabled={disabled}>
          <SelectTrigger className="h-9 w-[260px]">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}