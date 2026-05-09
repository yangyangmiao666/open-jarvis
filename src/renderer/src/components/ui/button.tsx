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
          "bg-foreground text-background hover:bg-foreground/90 hover:-translate-y-px",
        destructive:
          "border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10 hover:-translate-y-px",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-background-interactive hover:-translate-y-px",
        secondary:
          "border border-border bg-background-elevated text-foreground hover:bg-background-interactive hover:-translate-y-px",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground shadow-none hover:-translate-y-px hover:bg-background-interactive/72 hover:text-foreground",
        link: "border-none px-0 text-primary underline-offset-4 hover:text-primary/80 hover:underline",
        // Status variants
        nominal:
          "border border-status-nominal/50 bg-transparent text-status-nominal hover:bg-status-nominal/10 hover:-translate-y-px",
        warning:
          "border border-status-warning/50 bg-transparent text-status-warning hover:bg-status-warning/10 hover:-translate-y-px",
        critical:
          "border border-status-critical/50 bg-transparent text-status-critical hover:bg-status-critical/10 hover:-translate-y-px",
        info: "border border-status-info/50 bg-transparent text-status-info hover:bg-status-info/10 hover:-translate-y-px",
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
