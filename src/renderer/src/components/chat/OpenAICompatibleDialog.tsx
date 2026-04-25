import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { OpenAICompatibleProfile } from "@/types";

interface OpenAICompatibleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const emptyForm = (): Omit<OpenAICompatibleProfile, "id"> & {
  id?: string;
} => ({
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
});

export function OpenAICompatibleDialog({
  open,
  onOpenChange,
  onSaved,
}: OpenAICompatibleDialogProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<OpenAICompatibleProfile[]>([]);
  const [editing, setEditing] = useState<
    (Omit<OpenAICompatibleProfile, "id"> & { id?: string }) | null
  >(null);

  const load = async (): Promise<void> => {
    const list = await window.api.models.openaiCompatibleList();
    setProfiles(list);
  };

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();

      setEditing(null);
    }
  }, [open]);

  const handleSave = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.baseUrl.trim() || !editing.model.trim()) {
      return;
    }
    await window.api.models.openaiCompatibleUpsert(editing);
    await load();
    onSaved();
    setEditing(null);
  };

  const handleDelete = async (id: string): Promise<void> => {
    await window.api.models.openaiCompatibleDelete(id);
    await load();
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl flex flex-col">
        <DialogHeader>
          <DialogTitle>自定义模型配置</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="app-flat-surface flex items-start justify-between gap-4 rounded-[24px] px-5 py-5">
            <div className="min-w-0">
              <div className="text-section-header">Profiles</div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.03em] text-foreground">
                OpenAI Compatible 接入
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                在这里维护自定义 OpenAI 兼容接口，例如本地网关、代理服务或私有部署模型。保存后模型切换器会自动刷新。
              </p>
            </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit gap-1"
            onClick={() => setEditing(emptyForm())}
          >
            <Plus className="size-4" />
            添加配置
          </Button>
          </div>

          {editing && (
            <div className="app-flat-surface space-y-4 rounded-[24px] p-4">
              <div className="space-y-1">
                <label htmlFor="oac-name" className="text-sm font-medium">
                  显示名称
                </label>
                <Input
                  id="oac-name"
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="例如：本地 vLLM"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-base" className="text-sm font-medium">
                  接口地址（Base URL）
                </label>
                <Input
                  id="oac-base"
                  value={editing.baseUrl}
                  onChange={(e) =>
                    setEditing({ ...editing, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com 或 http://127.0.0.1:11434/v1"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-key" className="text-sm font-medium">
                  API 密钥
                </label>
                <Input
                  id="oac-key"
                  type="password"
                  value={editing.apiKey}
                  onChange={(e) =>
                    setEditing({ ...editing, apiKey: e.target.value })
                  }
                  placeholder="可填占位符，若网关不要求密钥"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="oac-model" className="text-sm font-medium">
                  模型 ID
                </label>
                <Input
                  id="oac-model"
                  value={editing.model}
                  onChange={(e) =>
                    setEditing({ ...editing, model: e.target.value })
                  }
                  placeholder="例如：gpt-4o、Qwen/Qwen2.5-7B-Instruct"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSave()}
                >
                  保存
                </Button>
              </div>
            </div>
          )}

          <ScrollArea className="min-h-0 rounded-[24px] border border-border/75">
            <div className="p-2 space-y-1">
              {profiles.length === 0 && !editing && (
                <p className="text-sm text-muted-foreground px-2 py-6 text-center">
                  暂无配置
                </p>
              )}
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-2xl px-3 py-2 text-xs hover:bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {p.name || p.model}
                    </div>
                    <div className="text-muted-foreground truncate font-mono">
                      {p.baseUrl}
                    </div>
                    <div className="text-muted-foreground truncate font-mono">
                      模型：{p.model}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => setEditing({ ...p })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => void handleDelete(p.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
