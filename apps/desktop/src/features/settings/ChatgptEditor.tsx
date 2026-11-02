import type { ReactNode } from "react";
import {
  ExternalLink,
  LoaderCircle,
  LogIn,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  daysUntil,
  formatPlan,
  ProviderIcon,
  type ChatgptSession,
} from "@/features/providers";
import { settingsButtonClass } from "./styles";
import type { ChatgptSignIn } from "./useChatgptSignIn";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function formatDate(iso: string | null) {
  return iso ? dateFormat.format(new Date(iso)) : "—";
}

const STATUS_BADGES: Record<
  ChatgptSession["state"],
  { label: string; variant: "success" | "outline" | "destructive" }
> = {
  connected: { label: "Connected", variant: "success" },
  pending: { label: "Waiting", variant: "outline" },
  expired: { label: "Expired", variant: "destructive" },
  disconnected: { label: "Not signed in", variant: "outline" },
};

function StatusBadge({ state }: { state: ChatgptSession["state"] }) {
  const { label, variant } = STATUS_BADGES[state];
  return <Badge variant={variant}>{label}</Badge>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-[13px]">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function ConnectedDetails({ session }: { session: ChatgptSession }) {
  const days = session.expiresAt ? daysUntil(session.expiresAt) : null;
  return (
    <dl className="mt-3 divide-y divide-border border-t border-border">
      <Detail label="Account">{session.email ?? "ChatGPT account"}</Detail>
      {session.plan && <Detail label="Plan">{formatPlan(session.plan)}</Detail>}
      <Detail label="Signed in">{formatDate(session.connectedAt)}</Detail>
      <Detail label="Expires">
        {formatDate(session.expiresAt)}
        {days !== null && (
          <span className="text-muted-foreground">
            {" "}
            · {days} {days === 1 ? "day" : "days"} left
          </span>
        )}
      </Detail>
    </dl>
  );
}

interface ChatgptEditorProps {
  signIn: ChatgptSignIn;
  onClose: () => void;
}

/** Sign in to, inspect, and sign out of the ChatGPT subscription provider. */
export function ChatgptEditor({ signIn, onClose }: ChatgptEditorProps) {
  const { session, busy, message } = signIn;
  const state = session?.state ?? "disconnected";
  const connected = state === "connected";
  const pending = state === "pending";
  return (
    <DialogContent className="z-[100] max-h-[calc(100vh-48px)] w-[min(460px,calc(100vw-32px))] overflow-y-auto p-6">
      <DialogTitle className="pr-6 text-base font-semibold">
        ChatGPT subscription
      </DialogTitle>
      <DialogDescription className="text-xs leading-5 text-muted-foreground">
        Use the models included in your ChatGPT plan. No API key is needed.
      </DialogDescription>
      <div className="flex flex-col gap-5">
        <section
          aria-label="Sign-in status"
          className="rounded-xl bg-foreground/[0.04] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderIcon
                id="chatgpt"
                className={connected ? "size-6" : "size-6 text-muted-foreground/60"}
              />
              <h3 className="text-sm font-medium">ChatGPT</h3>
            </div>
            <StatusBadge state={state} />
          </div>
          {connected && session && <ConnectedDetails session={session} />}
          {pending && (
            <div className="mt-3 flex items-start gap-2.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              <LoaderCircle
                size={14}
                className="mt-0.5 shrink-0 animate-spin"
                aria-hidden
              />
              <p>
                Finish signing in on the ChatGPT page in your browser. This
                window updates automatically.
              </p>
            </div>
          )}
          {state === "expired" && (
            <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
              This sign-in reached its 30-day limit. Sign in again to keep
              using ChatGPT models.
            </p>
          )}
        </section>
        <p className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
          Your sign-in is encrypted by Windows on the backend, stays on this
          computer, and expires 30 days after you sign in. It is never sent to
          this app.
        </p>
        <output className="min-h-4 text-xs text-muted-foreground">
          {message}
        </output>
        <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
          {connected ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void signIn.signOut()}
              className={settingsButtonClass}
            >
              <LogOut size={14} aria-hidden />
              Sign out
            </Button>
          ) : pending ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void signIn.reopen()}
              className={settingsButtonClass}
            >
              <ExternalLink size={14} aria-hidden />
              Open sign-in page
            </Button>
          ) : state === "expired" ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void signIn.signOut()}
              className={settingsButtonClass}
            >
              <LogOut size={14} aria-hidden />
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {pending ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void signIn.cancel()}
                className={settingsButtonClass}
              >
                Cancel sign-in
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  className={settingsButtonClass}
                >
                  {connected ? "Done" : "Cancel"}
                </Button>
                {!connected && (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void signIn.signIn()}
                    className={settingsButtonClass}
                  >
                    {busy ? (
                      <LoaderCircle
                        size={14}
                        className="animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <LogIn size={14} aria-hidden />
                    )}
                    {state === "expired" ? "Sign in again" : "Sign in with ChatGPT"}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
