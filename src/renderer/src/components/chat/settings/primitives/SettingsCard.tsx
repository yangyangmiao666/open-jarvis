import { type ReactNode, Children, isValidElement } from "react";
import { Separator } from "@/components/ui/separator";
import { CARD_CLASS, DIVIDER_CLASS } from "./SettingsUIConstants";

interface SettingsCardProps {
  children: ReactNode;
  className?: string;
  divided?: boolean;
}

export function SettingsCard({
  children,
  className = "",
  divided = true,
}: SettingsCardProps) {
  const childArray = Children.toArray(children).filter(isValidElement);

  if (!divided || childArray.length <= 1) {
    return <div className={`${CARD_CLASS} ${className}`}>{children}</div>;
  }

  return (
    <div className={`${CARD_CLASS} ${className}`}>
      {childArray.map((child, i) => (
        <div key={i}>
          {i > 0 && <Separator className={DIVIDER_CLASS} />}
          {child}
        </div>
      ))}
    </div>
  );
}
