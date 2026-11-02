import { useState, type ReactNode } from "react";
import { LogIn, Plug, SlidersHorizontal, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  providersLoaded,
  providersSchema,
  providerNames as names,
  providerIds as catalog,
  describeChatgptSession,
  isSubscriptionProvider,
  ProviderIcon,
  type Provider,
} from "@/features/providers";
import { backendRequest, errorMessage } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { ChatgptEditor } from "./ChatgptEditor";
import { ProviderEditor } from "./ProviderEditor";
import { useChatgptSignIn } from "./useChatgptSignIn";

/** An icon-only action with a tooltip, used for the per-provider controls. */
function IconAction({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={destructive ? "destructive" : "ghost"}
          size="icon"
          className={
            destructive
              ? "size-9 rounded-lg"
              : "size-9 rounded-lg text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          }
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProvidersSettings() {
  const dispatch = useAppDispatch();
  const { items, connected } = useAppSelector((state) => state.providers);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const chatgpt = useChatgptSignIn();
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(
    null,
  );
  async function change(path: string, method: string, body?: unknown) {
    setBusy(true);
    setMessage("");
    try {
      dispatch(
        providersLoaded(
          await backendRequest(path, providersSchema, method, body),
        ),
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-6">
        <header>
          <h2
            id="settings-section-heading"
            className="text-[17px] font-semibold"
          >
            Model providers
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Connect the providers you use. You pick the provider and model in the chat.
          </p>
        </header>
        {!connected && (
          <p className="text-xs text-brand">
            Waiting for your local backend to connect automatically.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {catalog.map((id) => {
            const provider = items.find((item) => item.id === id) ?? {
              id,
              configured: false,
              active: false,
              model: "",
              baseUrl: "",
            };
            const subscription = isSubscriptionProvider(id);
            const sessionSummary = subscription
              ? describeChatgptSession(chatgpt.session)
              : "";
            const removable =
              provider.configured ||
              (subscription && chatgpt.session?.state === "expired");
            return (
              <div
                key={id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-foreground/[0.04] p-4"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <ProviderIcon
                    id={id}
                    className={cn(
                      "size-6 transition-opacity",
                      provider.configured
                        ? "text-foreground"
                        : "text-muted-foreground/60",
                    )}
                  />
                  <div>
                    <h3 className="text-sm font-medium">{names[id]}</h3>
                    {subscription && sessionSummary ? (
                      <p className="mt-1 max-w-[260px] truncate text-xs text-muted-foreground">
                        {sessionSummary}
                      </p>
                    ) : (
                      !provider.configured && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {subscription ? "Not signed in" : "Not configured"}
                        </p>
                      )
                    )}
                    {provider.baseUrl && (
                      <p
                        className="mt-1 max-w-[260px] truncate text-[11px] text-muted-foreground/70"
                        title={provider.baseUrl}
                      >
                        {provider.baseUrl}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {removable && (
                    <IconAction
                      label={
                        confirmingRemoval === id
                          ? "Click again to confirm"
                          : subscription
                            ? "Sign out"
                            : "Remove"
                      }
                      destructive={confirmingRemoval === id}
                      disabled={busy}
                      onClick={() => {
                        // Removing deletes the saved key or sign-in, so ask for a second click.
                        if (confirmingRemoval !== id) {
                          setConfirmingRemoval(id);
                          window.setTimeout(
                            () =>
                              setConfirmingRemoval((current) =>
                                current === id ? null : current,
                              ),
                            3000,
                          );
                          return;
                        }
                        setConfirmingRemoval(null);
                        void change(`/providers/${id}`, "DELETE");
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconAction>
                  )}
                  <IconAction
                    label={
                      subscription
                        ? provider.configured
                          ? "Manage sign-in"
                          : "Sign in"
                        : provider.configured
                          ? "Configure"
                          : "Connect"
                    }
                    disabled={!connected || busy}
                    onClick={() => setEditing(provider)}
                  >
                    {subscription && !provider.configured ? (
                      <LogIn className="size-4" />
                    ) : provider.configured ? (
                      <SlidersHorizontal className="size-4" />
                    ) : (
                      <Plug className="size-4" />
                    )}
                  </IconAction>
                </div>
              </div>
            );
          })}
        </div>
        <output className="text-xs text-muted-foreground">{message}</output>
        <Dialog
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        >
          {editing &&
            (isSubscriptionProvider(editing.id) ? (
              <ChatgptEditor
                signIn={chatgpt}
                onClose={() => setEditing(null)}
              />
            ) : (
              <ProviderEditor
                provider={editing}
                onSaved={(providers) => dispatch(providersLoaded(providers))}
                onClose={() => setEditing(null)}
              />
            ))}
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
