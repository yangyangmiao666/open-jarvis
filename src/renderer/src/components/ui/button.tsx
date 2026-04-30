import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-medium transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_12%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_20%,transparent),0_0_0_1px_color-mix(in_srgb,var(--primary)_14%,transparent)] hover:-translate-y-0.5 hover:bg-primary/96 hover:shadow-[0_10px_22px_color-mix(in_srgb,var(--primary)_15%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_24%,transparent),0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
        destructive:
          "bg-destructive text-white shadow-[0_8px_18px_color-mix(in_srgb,var(--destructive)_10%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_18%,transparent),0_0_0_1px_color-mix(in_srgb,var(--destructive)_12%,transparent)] hover:-translate-y-0.5 hover:bg-destructive/94 hover:shadow-[0_10px_22px_color-mix(in_srgb,var(--destructive)_12%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_22%,transparent),0_0_0_1px_color-mix(in_srgb,var(--destructive)_15%,transparent)]",
        outline:
          "border-border/80 bg-card/72 text-foreground/92 backdrop-blur-md shadow-[0_6px_14px_color-mix(in_srgb,#000_3%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_10%,transparent),0_0_0_1px_color-mix(in_srgb,var(--foreground)_3%,transparent)] hover:-translate-y-0.5 hover:border-primary/24 hover:bg-background-interactive/84 hover:shadow-[0_8px_18px_color-mix(in_srgb,#000_4%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent),0_0_0_1px_color-mix(in_srgb,var(--primary)_12%,transparent)]",
        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground shadow-[0_6px_14px_color-mix(in_srgb,#000_3%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_10%,transparent),0_0_0_1px_color-mix(in_srgb,var(--foreground)_3%,transparent)] hover:-translate-y-0.5 hover:border-border-emphasis hover:bg-secondary/92 hover:shadow-[0_8px_18px_color-mix(in_srgb,#000_4%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent),0_0_0_1px_color-mix(in_srgb,var(--primary)_10%,transparent)]",
        ghost:
          "text-muted-foreground hover:-translate-y-0.5 hover:bg-background-interactive/88 hover:text-foreground",
        link: "border-none px-0 text-primary underline-offset-4 hover:text-primary/80 hover:underline",
        // Status variants
        nominal:
          "bg-status-nominal text-background shadow-[0_8px_18px_color-mix(in_srgb,var(--status-nominal)_11%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_18%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-nominal)_12%,transparent)] hover:-translate-y-0.5 hover:bg-status-nominal/94 hover:shadow-[0_10px_22px_color-mix(in_srgb,var(--status-nominal)_13%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_22%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-nominal)_15%,transparent)]",
        warning:
          "bg-status-warning text-background shadow-[0_8px_18px_color-mix(in_srgb,var(--status-warning)_11%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_18%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-warning)_12%,transparent)] hover:-translate-y-0.5 hover:bg-status-warning/94 hover:shadow-[0_10px_22px_color-mix(in_srgb,var(--status-warning)_13%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_22%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-warning)_15%,transparent)]",
        critical:
          "bg-status-critical text-white shadow-[0_8px_18px_color-mix(in_srgb,var(--status-critical)_11%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_18%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-critical)_12%,transparent)] hover:-translate-y-0.5 hover:bg-status-critical/94 hover:shadow-[0_10px_22px_color-mix(in_srgb,var(--status-critical)_13%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_22%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-critical)_15%,transparent)]",
        info: "bg-status-info text-white shadow-[0_8px_18px_color-mix(in_srgb,var(--status-info)_11%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_18%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-info)_12%,transparent)] hover:-translate-y-0.5 hover:bg-status-info/94 hover:shadow-[0_10px_22px_color-mix(in_srgb,var(--status-info)_13%,transparent),inset_0_1px_0_color-mix(in_srgb,#fff_22%,transparent),0_0_0_1px_color-mix(in_srgb,var(--status-info)_15%,transparent)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
