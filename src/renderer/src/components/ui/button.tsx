import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 disabled:saturate-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985]",
  {
    variants: {
      variant: {
        default:
          "app-premium-button-primary text-[#08121d] hover:-translate-y-px",
        destructive:
          "app-premium-button text-destructive hover:-translate-y-px",
        outline:
          "app-premium-button text-foreground/92 hover:-translate-y-px",
        secondary:
          "app-premium-button text-secondary-foreground hover:-translate-y-px",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground shadow-none hover:-translate-y-px hover:bg-background-interactive/72 hover:text-foreground",
        link: "border-none px-0 text-primary underline-offset-4 hover:text-primary/80 hover:underline",
        // Status variants
        nominal:
          "app-premium-button text-status-nominal hover:-translate-y-px",
        warning:
          "app-premium-button text-status-warning hover:-translate-y-px",
        critical:
          "app-premium-button text-status-critical hover:-translate-y-px",
        info: "app-premium-button text-status-info hover:-translate-y-px",
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
