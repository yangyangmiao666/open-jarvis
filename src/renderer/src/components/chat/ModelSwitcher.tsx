import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Check,
  AlertCircle,
  Key,
  Boxes,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { useCurrentThread } from "@/lib/thread-context";
import { cn } from "@/lib/utils";
import { ApiKeyDialog } from "./ApiKeyDialog";
import type { Provider, ProviderId, SettingsOpenRequest } from "@/types";

// Provider icons as simple SVG components
function AnthropicIcon({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.304 3.541h-3.672l6.696 16.918h3.672l-6.696-16.918zm-10.608 0L0 20.459h3.744l1.368-3.562h7.044l1.368 3.562h3.744L10.608 3.541H6.696zm.576 10.852l2.352-6.122 2.352 6.122H7.272z" />
    </svg>
  );
}

function OpenAIIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" />
    </svg>
  );
}

function CustomModelIcon({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  return <Boxes className={className} aria-hidden />;
}

const PROVIDER_ICONS: Record<ProviderId, React.FC<{ className?: string }>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  ollama: () => null,
  openai_compatible: CustomModelIcon,
};

// Fallback providers in case the backend hasn't loaded them yet
// Note: defined inside the component to access i18n t()

interface ModelSwitcherProps {
  threadId: string;
  onOpenSettings: (request?: SettingsOpenRequest) => void;
}

export function ModelSwitcher({
  threadId,
  onOpenSettings,
}: ModelSwitcherProps): React.JSX.Element {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] =
    useState<ProviderId | null>(null);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const [apiKeyProvider, setApiKeyProvider] = useState<Provider | null>(null);

  const FALLBACK_PROVIDERS: Provider[] = [
    { id: "openai_compatible", name: t("modelSwitcher.customModel"), hasApiKey: false },
  ];

  const { models, providers, loadModels, loadProviders } = useAppStore();
  const { currentModel, setCurrentModel } = useCurrentThread(threadId);

  // Load models and providers on mount
  useEffect(() => {
    loadModels();
    loadProviders();
  }, [loadModels, loadProviders]);

  // Use fallback providers if none loaded
  const displayProviders =
    providers.length > 0 ? providers : FALLBACK_PROVIDERS;

  // Determine effective provider ID (manual selection > current model > default)
  const effectiveProviderId =
    selectedProviderId ||
    (currentModel
      ? models.find((m) => m.id === currentModel)?.provider
      : null) ||
    (displayProviders.length > 0 ? displayProviders[0].id : null);

  const selectedModel = models.find((m) => m.id === currentModel);
  const filteredModels = effectiveProviderId
    ? models.filter((m) => m.provider === effectiveProviderId)
    : [];
  const selectedProvider = displayProviders.find(
    (p) => p.id === effectiveProviderId,
  );

  function buildModelSettingsRequest(): SettingsOpenRequest {
    return {
      panel: "models",
      profileId: currentModel.startsWith("oac:") ? currentModel.slice(4) : undefined,
    };
  }

  function handleProviderClick(provider: Provider): void {
    setSelectedProviderId(provider.id);
  }

  function handleModelSelect(modelId: string): void {
    setCurrentModel(modelId);
    setOpen(false);
  }

  function handleConfigureApiKey(provider: Provider): void {
    if (provider.id === "openai_compatible") {
      onOpenSettings(buildModelSettingsRequest());
      setOpen(false);
      return;
    }
    setApiKeyProvider(provider);
    setApiKeyDialogOpen(true);
  }

  function handleApiKeyDialogClose(isOpen: boolean): void {
    setApiKeyDialogOpen(isOpen);
    if (!isOpen) {
      // Refresh providers after dialog closes
      loadProviders();
      loadModels();
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:translate-y-0 hover:text-foreground"
          >
            {selectedModel ? (
              <>
                {PROVIDER_ICONS[selectedModel.provider]?.({
                  className: "size-3.5 shrink-0",
                })}
                <span
                  className="truncate max-w-[200px] text-left"
                  title={selectedModel.id}
                >
                  {selectedModel.name}
                </span>
              </>
            ) : (
              <span>{t("modelSwitcher.selectModel")}</span>
            )}
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[520px] rounded-[28px] p-0 shadow-none"
          align="start"
          sideOffset={8}
        >
          <div className="flex min-h-[240px] flex-col">
            <div className="flex min-h-[240px]">
            {/* Provider column */}
              <div className="w-[168px] border-r border-border/70 bg-muted/25 p-3">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("modelSwitcher.provider")}
              </div>
              <div className="space-y-0.5">
                {displayProviders.map((provider) => {
                  const Icon = PROVIDER_ICONS[provider.id];
                  return (
                    <button
                      key={provider.id}
                      onClick={() => handleProviderClick(provider)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-2xl px-3 py-2 text-left text-xs transition-colors",
                        effectiveProviderId === provider.id
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      {Icon && <Icon className="size-3.5 shrink-0" />}
                      <span className="flex-1 truncate">{provider.name}</span>
                      {!provider.hasApiKey && (
                        <AlertCircle className="size-3 text-status-warning shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
              </div>

            {/* Models column */}
              <div className="flex-1 p-3">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("modelSwitcher.models")}
              </div>

              {selectedProvider &&
              selectedProvider.id !== "openai_compatible" &&
              !selectedProvider.hasApiKey ? (
                <div className="flex h-[180px] flex-col items-center justify-center px-6 text-center">
                  <Key className="size-6 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("modelSwitcher.needApiKey", { name: selectedProvider.name })}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => handleConfigureApiKey(selectedProvider)}
                  >
                    {t("modelSwitcher.configureApiKey")}
                  </Button>
                </div>
              ) : selectedProvider?.id === "openai_compatible" &&
                !selectedProvider.hasApiKey ? (
                <div className="flex h-[180px] flex-col items-center justify-center px-6 text-center">
                  <Key className="size-6 text-muted-foreground mb-2" />
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("modelSwitcher.needCustomModel")}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      onOpenSettings(buildModelSettingsRequest());
                      setOpen(false);
                    }}
                  >
                    {t("modelSwitcher.setupModel")}
                  </Button>
                </div>
              ) : (
                // Show models list with scrollable area
                <div className="flex h-[220px] flex-col">
                  <div className="flex-1 space-y-1 overflow-y-auto pr-1">
                    {filteredModels.map((model) => {
                      const hideIdRow =
                        model.provider === "openai_compatible" ||
                        model.id.startsWith("oac:");
                      const showSecondLine =
                        !hideIdRow && model.name !== model.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => handleModelSelect(model.id)}
                          className={cn(
                            "flex w-full items-start gap-1.5 rounded-2xl px-3 py-2 text-left text-xs transition-colors",
                            currentModel === model.id
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          )}
                          title={model.id}
                        >
                          <span className="flex-1 min-w-0 text-left">
                            <span className="block truncate font-medium text-foreground/90">
                              {model.name}
                            </span>
                            {showSecondLine && (
                              <span className="block truncate font-mono text-[10px] text-muted-foreground mt-0.5">
                                {model.id}
                              </span>
                            )}
                          </span>
                          {currentModel === model.id && (
                            <Check className="size-3.5 shrink-0 text-foreground mt-0.5" />
                          )}
                        </button>
                      );
                    })}

                    {filteredModels.length === 0 && (
                      <p className="text-xs text-muted-foreground px-2 py-4">
                        {t("modelSwitcher.noAvailableModels")}
                      </p>
                    )}
                  </div>

                  {/* Configure API key link for providers that have a key */}
                  {selectedProvider?.hasApiKey && (
                    <button
                      onClick={() => handleConfigureApiKey(selectedProvider)}
                      className="mt-2 flex w-full items-center gap-2 rounded-2xl border border-border/70 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground hover:border-border"
                    >
                      <Key className="size-3.5" />
                      <span>
                        {selectedProvider.id === "openai_compatible"
                          ? t("modelSwitcher.setupModel")
                          : t("modelSwitcher.editApiKey")}
                      </span>
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <ApiKeyDialog
        open={apiKeyDialogOpen}
        onOpenChange={handleApiKeyDialogClose}
        provider={apiKeyProvider}
      />
    </>
  );
}
