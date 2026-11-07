import { useState, type FormEvent } from "react";
import { z } from "zod";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isCompatibleProvider, providersSchema, type Provider } from "@/features/providers";
import { providerNames as names } from "@/features/providers";
import { backendRequest, errorMessage } from "@/lib/backend";
import { fieldClass, settingsButtonClass } from "./styles";

interface ProviderEditorProps {
  provider: Provider;
  onSaved: (providers: Provider[]) => void;
  onClose: () => void;
}

/** The form that saves one model provider: its model, key and endpoint, and tests it. */
export function ProviderEditor({ provider, onSaved, onClose }: ProviderEditorProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(provider.model);
  const compatible = isCompatibleProvider(provider.id);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [pictures, setPictures] = useState(provider.acceptsImages);
  const endpoint = compatible ? { baseUrl: baseUrl.trim() } : {};
  const endpointChanged = compatible && provider.configured && baseUrl.trim().replace(/\/+$/, "") !== provider.baseUrl;
  const needsKey = !provider.configured || endpointChanged;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const submittedModel = data.get("model");
    const key = data.get("apiKey");
    if (typeof submittedModel !== "string") return;
    setBusy(true);
    setMessage("");
    try {
      onSaved(
        await backendRequest(`/providers/${provider.id}`, providersSchema, "POST", {
          model: submittedModel.trim(),
          ...endpoint,
          ...(compatible ? { acceptsImages: pictures } : {}),
          ...(typeof key === "string" && key.trim() ? { apiKey: key.trim() } : {}),
        }),
      );
      form.reset();
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function probe(test: boolean) {
    setBusy(true);
    setMessage("");
    try {
      if (test) {
        const result = await backendRequest(
          `/providers/${provider.id}/test`,
          z.object({ connected: z.boolean(), modelAvailable: z.boolean() }),
          "POST",
          {
            model,
            ...endpoint,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          },
        );
        setMessage(
          result.modelAvailable
            ? "Connection successful. Model is available."
            : "Key accepted. The selected model was not listed for this account.",
        );
      } else {
        const result = await backendRequest(
          `/providers/${provider.id}/models`,
          z.object({ models: z.array(z.string()) }),
          "POST",
          { ...endpoint, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
        );
        setModels(result.models);
        setMessage(`Loaded ${result.models.length} models.`);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <DialogContent className="z-[100] max-h-[calc(100vh-48px)] w-[min(460px,calc(100vw-32px))] overflow-y-auto p-6">
      <DialogTitle className="pr-6 text-base font-semibold">Configure {names[provider.id]}</DialogTitle>
      <DialogDescription className="text-xs leading-5 text-muted-foreground">
        Enter your key to load models and test access.
      </DialogDescription>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-5">
        {compatible && (
          <div className="flex flex-col gap-2">
            <label htmlFor="provider-base-url" className="text-xs">
              Base URL
            </label>
            <Input
              id="provider-base-url"
              name="baseUrl"
              type="url"
              required
              maxLength={2048}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              className={fieldClass}
            />
            <p className="text-[11px] leading-5 text-muted-foreground">
              API prefix, usually ending in /v1. Use HTTPS, or HTTP for localhost.
            </p>
          </div>
        )}
        {compatible && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="provider-pictures" className="text-xs">
                Send pictures
              </label>
              <p className="text-[11px] leading-5 text-muted-foreground">
                Turn off for a model that cannot read images. The assistant then checks the scene from measurements
                only.
              </p>
            </div>
            <Switch id="provider-pictures" checked={pictures} onCheckedChange={setPictures} />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="provider-key" className="text-xs">
            API key
          </label>
          <Input
            id="provider-key"
            name="apiKey"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            required={needsKey}
            placeholder={
              provider.configured && !endpointChanged
                ? "Saved securely · enter a new key to replace"
                : "Enter your API key"
            }
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="provider-model" className="text-xs">
            Model ID
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="provider-model"
              name="model"
              list="provider-models"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              required
              maxLength={160}
              placeholder="Enter or select a model"
              className={fieldClass}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={busy || (needsKey && !apiKey.trim()) || (compatible && !baseUrl.trim())}
              onClick={() => void probe(false)}
              className="size-10 shrink-0 rounded-lg"
              aria-label="Load provider models"
              title="Load provider models"
            >
              <RefreshCw size={16} />
            </Button>
          </div>
          <datalist id="provider-models">
            {models.map((modelId) => (
              <option value={modelId} key={modelId}>
                {modelId}
              </option>
            ))}
          </datalist>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Keys are encrypted by Windows on the backend and never returned to this app.
        </p>
        <output className="text-xs text-muted-foreground">{message}</output>
        <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
          <Button
            type="button"
            disabled={busy || (needsKey && !apiKey.trim()) || (compatible && !baseUrl.trim())}
            variant="outline"
            onClick={() => void probe(true)}
            className={settingsButtonClass}
          >
            Test connection
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} className={settingsButtonClass}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className={settingsButtonClass}>
              {busy && <LoaderCircle size={14} className="animate-spin" />}Save
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}
