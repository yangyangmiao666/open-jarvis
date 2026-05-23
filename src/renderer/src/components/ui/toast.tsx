import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background-elevated group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-[0_8px_24px_color-mix(in_srgb,#000_12%,transparent)] group-[.toaster]:rounded-xl group-[.toaster]:text-sm",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success:
            "group-[.toaster]:border-green-500/30 group-[.toaster]:bg-green-500/10",
          error:
            "group-[.toaster]:border-red-500/30 group-[.toaster]:bg-red-500/10",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
