/* eslint-disable no-await-in-loop -- Stream reconnects must wait for the previous stream and status check. */
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAssistantSelection } from "./useAssistantSelection";
import { useReasoningEffort } from "./useReasoningEffort";
import { BackendResponseError, backendRequest, errorMessage } from "@/lib/backend";
import { forgetCaptures, type ViewCaptureHandler } from "@/features/viewCapture";
import type { EditorScene } from "./EditorScene";
import { connectEditor, type EditorConnection } from "./editorConnection";
import { toUploads, type ComposerImage } from "../attachments";
import { OncePerKey, RunSlot } from "./runSlot";
import { waitForAbortable } from "./waitForAbortable";
import { acceptedSchema, approvalSchema, readRunProgress } from "./runClient";
import { savedExchangesToMessages, type SavedExchange } from "./conversationMessages";
import { applyRunEvent, settleActivity } from "./runEvents";
import { recoverSavedScene } from "../objectEditing/sceneHistory";
import type { ChatMessage, RunPhase } from "./types";

type Approval = z.infer<typeof approvalSchema>;

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

function newMessage(
  role: ChatMessage["role"],
  content: string,
  state: ChatMessage["state"],
  images: readonly ComposerImage[] = [],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    state,
    activity: [],
    startedAt: Date.now(),
    ...(images.length > 0 ? { attachments: images.map(({ id, name, src }) => ({ id, name, src })) } : {}),
  };
}

/** What a reopened project hands back so its conversation can carry on. */
export interface SavedConversation {
  sessionId?: string | undefined;
  /** The provider and model of the last reply; the session continues only if the same one is used. */
  provider?: { id: string; model: string; baseUrl: string } | undefined;
  messages: readonly SavedExchange[];
}

/**
 * Drives one conversation with the assistant. `ensureProject` returns the id of the project the work
 * belongs to, creating it first if this is the first prompt. `capture` draws the viewport when the assistant
 * asks to look at the scene.
 */
export function useAssistantRun(
  editor: React.RefObject<EditorScene | null>,
  ensureProject: () => Promise<string>,
  capture: React.RefObject<ViewCaptureHandler | null>,
  beforeSubmit?: () => Promise<void>,
) {
  const { provider, model, connected } = useAssistantSelection();
  const { effort } = useReasoningEffort();
  const sessionProvider = useRef("");
  // One request owns the conversation at a time; a stopped one lets go at once, before it has wound down.
  const [slot] = useState(() => new RunSlot());
  // Buttons that send a request (Stop, Approve, Reject) must send it once however fast they are pressed.
  const [actions] = useState(() => new OncePerKey());
  const lastPrompt = useRef("");
  const lastImages = useRef<readonly ComposerImage[]>([]);
  const [status, setStatus] = useState("Ready");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const session = useRef<string | undefined>(undefined);
  const runId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const connection = useRef<EditorConnection | null>(null);
  useEffect(
    () => () => {
      if (runId.current)
        void backendRequest(`/agent-runs/${runId.current}/cancel`, z.unknown(), "POST").catch(() => undefined);
      controller.current?.abort();
      connection.current?.close();
    },
    [],
  );

  function patchMessage(id: string, change: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current.map((message) => (message.id === id ? change(message) : message)));
  }

  /** Ends a request that never started. The message stays in the chat, so Try again can send it, pictures included. */
  function failEarly(reason: string, message: string, images: readonly ComposerImage[]) {
    setStatus(reason);
    setPhase("failed");
    setMessages((current) => [
      ...current,
      newMessage("user", message, "done", images),
      { ...newMessage("assistant", "", "error"), error: reason },
    ]);
  }

  /**
   * Sends one request. `images` travel with it to the model; they are kept in the chat for this session, and
   * the backend stores only their names.
   */
  async function submit(message: string, images: readonly ComposerImage[] = [], onAccepted?: () => void) {
    const lease = slot.acquire();
    if (!lease) return;
    lastPrompt.current = message;
    lastImages.current = images;
    const scene = editor.current;
    if (!scene) {
      failEarly("The editor is still loading", message, images);
      slot.release(lease);
      return;
    }
    if (!provider || !model.trim() || !connected) {
      failEarly("Connect and select a provider and model first", message, images);
      slot.release(lease);
      return;
    }
    const fingerprint = `${provider.id}:${model.trim()}:${provider.baseUrl}`;
    if (sessionProvider.current !== fingerprint) {
      session.current = undefined;
      sessionProvider.current = fingerprint;
    }
    const reply = newMessage("assistant", "", "streaming");
    setMessages((current) => [...current, newMessage("user", message, "done", images), reply]);
    setBusy(true);
    setApprovals([]);
    setPhase("connecting");
    setStatus("Connecting…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      // Validate/refresh native authentication before opening the WebSocket, which cannot retry HTTP 401s.
      if (beforeSubmit) await waitForAbortable(abort.signal, beforeSubmit);
      abort.signal.throwIfAborted();
      await waitForAbortable(abort.signal, () =>
        backendRequest(
          "/agents",
          z.array(z.object({ id: z.string() })),
          "GET",
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
        ),
      );
      abort.signal.throwIfAborted();
      const projectId = await waitForAbortable(abort.signal, ensureProject);
      abort.signal.throwIfAborted();
      scene.bindProject(projectId);
      connection.current?.close();
      connection.current = await connectEditor(scene, abort.signal, capture);
      const accepted = await backendRequest(
        "/agent-runs",
        acceptedSchema,
        "POST",
        {
          projectId: scene.projectId,
          message,
          dimension: "3d",
          editorClientId: connection.current.clientId,
          useConfiguredProvider: true,
          providerId: provider.id,
          model: model.trim(),
          ...(images.length > 0 ? { attachments: toUploads(images) } : {}),
          ...(effort ? { reasoningEffort: effort } : {}),
          ...(session.current ? { sessionId: session.current } : {}),
        },
        // Not cancelled with the run: once sent, the backend may already have started it, and only its
        // id lets the run be stopped. Stopping while it is sent cancels the run as soon as the id is known.
        AbortSignal.timeout(20000),
      );
      if (abort.signal.aborted) {
        void backendRequest(`/agent-runs/${accepted.runId}/cancel`, z.unknown(), "POST").catch(() => undefined);
        return;
      }
      runId.current = accepted.runId;
      onAccepted?.();
      session.current = accepted.sessionId;
      setPhase("running");
      setStatus("Working");
      let terminal = false;
      const cursor = { id: "" };
      while (!terminal && !abort.signal.aborted) {
        const result = await readRunProgress(
          accepted.eventsUrl,
          accepted.runId,
          abort.signal,
          (event) => {
            patchMessage(reply.id, (current) => applyRunEvent(current, event));
            if (event.type === "tool.started") setStatus("Working");
            // The assistant stopped with work still open, so the run asks it to carry on.
            if (event.type === "agent.continued") setStatus("Finishing the unfinished work");
            if (event.type === "approval.required") {
              setPhase("waiting_approval");
              setStatus("Waiting for your approval");
              // The answer can arrive after the run has ended or been stopped; it must not bring the card back.
              const stillWaiting = () => !terminal && !abort.signal.aborted && runId.current === accepted.runId;
              void backendRequest(`/agent-runs/${accepted.runId}/approvals`, z.array(approvalSchema))
                .then((list) => {
                  if (stillWaiting()) setApprovals(list);
                })
                .catch(() => {
                  if (stillWaiting()) setStatus("Could not load approval details");
                });
            }
            if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) terminal = true;
          },
          cursor,
        );
        // Stopped while the run's state was being read: a newer request may own the status line by now.
        abort.signal.throwIfAborted();
        if (TERMINAL_STATUSES.includes(result.status)) {
          await recoverSavedScene(scene, true);
          terminal = true;
          const nextPhase: RunPhase =
            result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : "cancelled";
          setPhase(nextPhase);
          setStatus(result.error?.message ?? (result.status === "completed" ? "Completed" : "Cancelled"));
          patchMessage(reply.id, (current) => {
            const settled = settleActivity(current);
            return {
              ...settled,
              content:
                result.finalOutput && !settled.content.trimEnd().endsWith(result.finalOutput)
                  ? [settled.content.trimEnd(), result.finalOutput].filter(Boolean).join("\n\n")
                  : settled.content.trimEnd(),
              state: result.status === "completed" ? "done" : result.status === "failed" ? "error" : "cancelled",
              ...(result.error ? { error: result.error.message } : {}),
            };
          });
          setApprovals([]);
        } else {
          setStatus("Reconnecting to progress…");
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        const reason = errorMessage(error);
        setPhase("failed");
        setStatus(reason);
        patchMessage(reply.id, (current) => ({
          ...settleActivity(current),
          state: "error",
          error: reason,
        }));
      }
    } finally {
      slot.release(lease);
      // A stopped request can finish after the next one has started; it must not clear that one's run.
      if (controller.current === abort) runId.current = undefined;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  /** Stops following the run here, leaving whatever the backend still does to its own timeouts. */
  function stopLocally(reason: string) {
    controller.current?.abort();
    // The stopped request may take a while to notice (it can be waiting on the backend); the next message must not wait for it.
    slot.drop();
    runId.current = undefined;
    setBusy(false);
    setPhase("cancelled");
    setStatus(reason);
    setApprovals([]);
    setMessages((current) =>
      current.map((message) =>
        message.state === "streaming" ? { ...settleActivity(message), state: "cancelled" } : message,
      ),
    );
  }
  async function cancel() {
    const target = runId.current;
    if (!target) {
      stopLocally("Cancelled");
      return;
    }
    // Esc held down repeats; one request is enough, and the repeats would only come back as "already finished".
    await actions.run(`cancel:${target}`, async () => {
      try {
        await backendRequest(`/agent-runs/${target}/cancel`, z.unknown(), "POST");
      } catch (error) {
        // The backend answered, for example because the run already ended: its stream settles the run.
        if (error instanceof BackendResponseError) setStatus(errorMessage(error));
        // The backend could not be reached, so its stream will not settle the run either: stop here.
        else if (runId.current === target) stopLocally(`Stopped. ${errorMessage(error)}`);
      }
    });
  }
  /** Sends the user's answer to an approval. Rejects, so the card can say so, when the backend did not take it. */
  async function decide(id: string, decision: "approve" | "reject"): Promise<void> {
    const target = runId.current;
    if (!target) return;
    // A second click on the same card would be refused by the backend and then show as a failure.
    await actions.run(`approval:${id}`, async () => {
      try {
        await backendRequest(`/agent-runs/${target}/approvals/${id}`, z.unknown(), "POST", { decision });
        // The run may have ended while the answer was on its way; its own status stands then.
        if (runId.current !== target) return;
        setApprovals((current) => current.filter((item) => item.id !== id));
        setPhase("running");
        setStatus("Working");
      } catch (error) {
        if (runId.current !== target) return;
        setStatus(errorMessage(error));
        // The card is still on screen; it shows why the answer did not go through.
        throw error;
      }
    });
  }
  /** Clears the saved conversation and starts the next request in a new session. */
  async function clearChat(): Promise<void> {
    const lease = slot.acquire();
    if (!lease) throw new Error("Wait for the assistant to finish before clearing the chat.");
    setClearing(true);
    try {
      const scene = editor.current;
      if (scene?.hasProject) await backendRequest(`/projects/${scene.projectId}/conversation`, z.void(), "DELETE");
      connection.current?.close();
      connection.current = null;
      session.current = undefined;
      sessionProvider.current = "";
      lastPrompt.current = "";
      lastImages.current = [];
      forgetCaptures();
      setMessages([]);
      setApprovals([]);
      setPhase("idle");
      setStatus("Ready");
    } finally {
      slot.release(lease);
      setClearing(false);
    }
  }
  /** Shows the saved chat of a reopened project and lets the assistant continue its session. */
  function hydrate(saved: SavedConversation) {
    session.current = saved.sessionId;
    sessionProvider.current = saved.provider
      ? `${saved.provider.id}:${saved.provider.model.trim()}:${saved.provider.baseUrl}`
      : "";
    lastPrompt.current = saved.messages[saved.messages.length - 1]?.prompt ?? "";
    // The pictures of a saved request are not kept, so trying it again sends the words alone.
    lastImages.current = [];
    setMessages(savedExchangesToMessages(saved.messages));
  }
  /** Sends the most recent prompt again, e.g. after a failure or to get another take. */
  function retry() {
    if (lastPrompt.current) void submit(lastPrompt.current, lastImages.current);
  }
  return {
    submit,
    status,
    phase,
    messages,
    busy: busy || clearing,
    approvals,
    clearChat,
    cancel,
    decide,
    hydrate,
    retry,
    canRetry: !busy && !clearing && messages.some((message) => message.role === "user"),
    ready: connected && Boolean(provider) && Boolean(model.trim()),
  };
}

export type AssistantRun = ReturnType<typeof useAssistantRun>;
