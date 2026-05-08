import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "app-premium-pill inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] transition-[transform,border-color,background-color,color] duration-200",
  {
    variants: {
      variant: {
        default:
          "text-primary",
        secondary:
          "text-secondary-foreground",
        destructive:
          "text-destructive",
        outline:
          "text-foreground/92",
        // Status variants with 15% bg opacity
        nominal:
          "text-status-nominal",
        warning:
          "text-status-warning",
        critical:
          "text-status-critical",
        info: "text-status-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants };
