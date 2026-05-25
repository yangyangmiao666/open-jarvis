import * as DialogPrimitive from "@radix-ui/react-dialog";
import { SettingsPanel } from "@/components/chat/settings/SettingsPanel";
import type { SettingsOpenRequest } from "@/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request?: SettingsOpenRequest | null;
}

export function SettingsDialog({
  open,
  onOpenChange,
  request,
}: SettingsDialogProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/24 backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200"
        />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] w-[85vw] max-w-[992px] h-[85vh] max-h-[752px] bg-background text-foreground shadow-2xl rounded-xl overflow-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-200"
        >
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>
          <SettingsPanel onClose={() => onOpenChange(false)} request={request} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}