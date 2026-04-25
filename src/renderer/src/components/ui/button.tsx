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
          "bg-primary text-primary-foreground shadow-[0_10px_24px_color-mix(in_srgb,var(--primary)_22%,transparent)] hover:-translate-y-0.5 hover:bg-primary/95 hover:shadow-[0_18px_34px_color-mix(in_srgb,var(--primary)_28%,transparent)]",
        destructive:
          "bg-destructive text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--destructive)_18%,transparent)] hover:-translate-y-0.5 hover:bg-destructive/92",
        outline:
          "border-border/90 bg-background/30 backdrop-blur-sm hover:-translate-y-0.5 hover:border-border-emphasis hover:bg-background-interactive/80",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_12%,transparent)] hover:-translate-y-0.5 hover:bg-secondary/88",
        ghost:
          "text-muted-foreground hover:-translate-y-0.5 hover:bg-background-interactive/85 hover:text-foreground",
        link: "border-none px-0 text-primary underline-offset-4 hover:text-primary/80 hover:underline",
        // Status variants
        nominal:
          "bg-status-nominal text-background shadow-[0_10px_24px_color-mix(in_srgb,var(--status-nominal)_18%,transparent)] hover:-translate-y-0.5 hover:bg-status-nominal/92",
        warning:
          "bg-status-warning text-background shadow-[0_10px_24px_color-mix(in_srgb,var(--status-warning)_18%,transparent)] hover:-translate-y-0.5 hover:bg-status-warning/92",
        critical:
          "bg-status-critical text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--status-critical)_18%,transparent)] hover:-translate-y-0.5 hover:bg-status-critical/92",
        info: "bg-status-info text-white shadow-[0_10px_24px_color-mix(in_srgb,var(--status-info)_18%,transparent)] hover:-translate-y-0.5 hover:bg-status-info/92",
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
