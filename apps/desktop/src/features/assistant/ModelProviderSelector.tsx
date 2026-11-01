import { useState } from "react";
import { z } from "zod";
import { Check, ChevronDown, RefreshCw, Settings } from "lucide-react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsDialog } from "@/features/settings";
import { ProviderIcon, providerNames } from "@/features/providers";
import { backendRequest, errorMessage } from "@/lib/backend";
import { formatModelName } from "./modelNames";
import { useAssistantSelection } from "./useAssistantSelection";
import {
  selectAssistantModel,
  selectAssistantProvider,
} from "./selectionSlice";

export function ModelProviderSelector({ disabled }: { disabled: boolean }) {
  return <SelectorControls disabled={disabled} />;
}
function SelectorControls({ disabled }: { disabled: boolean }) {
  const dispatch = useAppDispatch();
  const { provider, model, connected, providers } = useAssistantSelection();
  const [models, setModels] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function loadModels() {
    if (!provider) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await backendRequest(
        `/providers/${provider.id}/models`,
        z.object({ models: z.array(z.string()) }),
        "POST",
      );
      setModels(result.models);
      setMessage(`${result.models.length} models loaded`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  function choose(value: string) {
    if (!provider || !value.trim()) return;
    dispatch(selectAssistantModel({ id: provider.id, model: value.trim() }));
    setOpen(false);
  }
  const options = [
    ...new Set([model, provider?.model ?? "", ...models]),
  ].filter(
    (value) =>
      value &&
      `${value} ${formatModelName(value)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next && !models.length && !loading && connected && provider)
            void loadModels();
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            size="sm"
            title={model || undefined}
            className="min-w-0 max-w-[min(200px,45vw)] gap-1.5 px-2 text-xs font-medium text-foreground/90 hover:bg-foreground/10 hover:text-foreground"
          >
            <span className="truncate">
              {model ? formatModelName(model) : "Select a model"}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          collisionPadding={12}
          className="flex max-h-[var(--radix-dropdown-menu-content-available-height)] w-[min(320px,calc(100vw-40px))] flex-col gap-3 overflow-hidden"
          onInteractOutside={(event) => {
            // The provider list renders in its own portal; picking from it is not an outside click.
            if (
              event.target instanceof Element &&
              event.target.closest('[data-slot="select-content"]')
            )
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (document.querySelector('[role="dialog"][data-state="open"]'))
              event.preventDefault();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label
              className="text-[11px] font-medium text-muted-foreground"
              htmlFor="assistant-provider"
            >
              Provider
            </label>
            <div className="flex gap-2">
              <Select
                value={provider?.id ?? ""}
                disabled={disabled || !connected || !providers.length}
                onValueChange={(value) => {
                  const next = providers.find((item) => item.id === value);
                  if (next) {
                    setModels([]);
                    setMessage("");
                    setQuery("");
                    dispatch(
                      selectAssistantProvider({
                        id: next.id,
                        model: next.model,
                      }),
                    );
                  }
                }}
              >
                <SelectTrigger
                  id="assistant-provider"
                  className="min-w-0 flex-1"
                >
                  <SelectValue placeholder="No provider configured" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="flex items-center gap-2">
                        <ProviderIcon id={item.id} className="size-4" />
                        {providerNames[item.id]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="size-8"
                disabled={loading || !provider || !connected}
                onClick={() => void loadModels()}
                aria-label="Refresh models"
              >
                <RefreshCw
                  className={loading ? "size-3.5 animate-spin" : "size-3.5"}
                />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="size-8"
                title="Provider settings"
                aria-label="Provider settings"
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <Settings className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              className="text-[11px] font-medium text-muted-foreground"
              htmlFor="assistant-model-search"
            >
              Model
            </label>
            <Input
              id="assistant-model-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  choose(query);
                }
              }}
              placeholder="Search or enter model ID"
              className="h-8 text-xs md:text-xs"
              disabled={!provider || disabled}
            />
          </div>
          <div className="flex max-h-48 min-h-12 flex-1 flex-col gap-0.5 overflow-y-auto">
            {options.map((id) => (
              <Button
                type="button"
                key={id}
                variant="ghost"
                disabled={disabled}
                onClick={() => choose(id)}
                className="h-auto justify-between gap-2 px-2 py-1.5 text-left text-xs font-normal"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px]">
                    {formatModelName(id)}
                  </span>
                  {formatModelName(id) !== id && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {id}
                    </span>
                  )}
                </span>
                {model === id && <Check className="size-3.5 shrink-0" />}
              </Button>
            ))}
            {query.trim() && !options.includes(query.trim()) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => choose(query)}
                className="h-8 justify-start truncate px-2 text-xs font-normal"
              >
                Use {query.trim()}
              </Button>
            )}
          </div>
          <output className="min-h-4 text-[11px] text-muted-foreground">
            {!connected
              ? "Waiting for local backend…"
              : !provider
                ? "Configure a provider to start."
                : message}
          </output>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SettingsDialog initialTab="providers" />
      </Dialog>
    </>
  );
}
