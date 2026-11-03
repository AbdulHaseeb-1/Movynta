/* eslint-disable no-await-in-loop -- Stream reconnects must wait for the previous stream and status check. */
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAssistantSelection } from "./useAssistantSelection";
import { useReasoningEffort } from "./useReasoningEffort";
import { backendRequest, errorMessage } from "@/lib/backend";
import type { ViewCaptureHandler } from "@/features/viewCapture";
import type { EditorScene } from "./EditorScene";
import { connectEditor, type EditorConnection } from "./editorConnection";
import { acceptedSchema, approvalSchema, getRun, streamRun } from "./runClient";
import {
  savedExchangesToMessages,
  type SavedExchange,
} from "./conversationMessages";
import { applyRunEvent, settleActivity } from "./runEvents";
import { recoverSavedScene } from "../objectEditing/sceneHistory";
import type { ChatMessage, RunPhase } from "./types";

type Approval = z.infer<typeof approvalSchema>;

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

function newMessage(
  role: ChatMessage["role"],
  content: string,
  state: ChatMessage["state"],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    state,
    activity: [],
    startedAt: Date.now(),
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
  const inFlight = useRef(false);
  const lastPrompt = useRef("");
  const [status, setStatus] = useState("Ready");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const session = useRef<string | undefined>(undefined);
  const runId = useRef<string | undefined>(undefined);
  const controller = useRef<AbortController | null>(null);
  const connection = useRef<EditorConnection | null>(null);
  useEffect(
    () => () => {
      if (runId.current)
        void backendRequest(
          `/agent-runs/${runId.current}/cancel`,
          z.unknown(),
          "POST",
        ).catch(() => undefined);
      controller.current?.abort();
      connection.current?.close();
    },
    [],
  );

  function patchMessage(
    id: string,
    change: (message: ChatMessage) => ChatMessage,
  ) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? change(message) : message)),
    );
  }

  function failEarly(reason: string) {
    setStatus(reason);
    setPhase("failed");
    setMessages((current) => [
      ...current,
      { ...newMessage("assistant", "", "error"), error: reason },
    ]);
  }

  async function submit(message: string, onAccepted?: () => void) {
    if (inFlight.current) return;
    const scene = editor.current;
    if (!scene) {
      failEarly("The editor is still loading");
      return;
    }
    inFlight.current = true;
    if (!provider || !model.trim() || !connected) {
      failEarly("Connect and select a provider and model first");
      inFlight.current = false;
      return;
    }
    const fingerprint = `${provider.id}:${model.trim()}:${provider.baseUrl}`;
    if (sessionProvider.current !== fingerprint) {
      session.current = undefined;
      sessionProvider.current = fingerprint;
    }
    lastPrompt.current = message;
    const reply = newMessage("assistant", "", "streaming");
    setMessages((current) => [
      ...current,
      newMessage("user", message, "done"),
      reply,
    ]);
    setBusy(true);
    setApprovals([]);
    setPhase("connecting");
    setStatus("Connecting…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      // Validate/refresh native authentication before opening the WebSocket, which cannot retry HTTP 401s.
      await beforeSubmit?.();
      await backendRequest("/agents", z.array(z.object({ id: z.string() })));
      scene.bindProject(await ensureProject());
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
          ...(effort ? { reasoningEffort: effort } : {}),
          ...(session.current ? { sessionId: session.current } : {}),
        },
        abort.signal,
      );
      runId.current = accepted.runId;
      onAccepted?.();
      session.current = accepted.sessionId;
      setPhase("running");
      setStatus("Working");
      let terminal = false;
      const cursor = { id: "" };
      while (!terminal && !abort.signal.aborted) {
        await streamRun(
          accepted.eventsUrl,
          abort.signal,
          (event) => {
            patchMessage(reply.id, (current) => applyRunEvent(current, event));
            if (event.type === "tool.started") setStatus("Working");
            if (event.type === "approval.required") {
              setPhase("waiting_approval");
              setStatus("Waiting for your approval");
              void backendRequest(
                `/agent-runs/${accepted.runId}/approvals`,
                z.array(approvalSchema),
              )
                .then(setApprovals)
                .catch(() => setStatus("Could not load approval details"));
            }
            if (
              ["run.completed", "run.failed", "run.cancelled"].includes(
                event.type,
              )
            )
              terminal = true;
          },
          cursor,
        );
        const result = await getRun(accepted.runId);
        if (TERMINAL_STATUSES.includes(result.status)) {
          await recoverSavedScene(scene, true);
          terminal = true;
          const nextPhase: RunPhase =
            result.status === "completed"
              ? "completed"
              : result.status === "failed"
                ? "failed"
                : "cancelled";
          setPhase(nextPhase);
          setStatus(
            result.error?.message ??
              (result.status === "completed" ? "Completed" : "Cancelled"),
          );
          patchMessage(reply.id, (current) => {
            const settled = settleActivity(current);
            return {
              ...settled,
              content:
                result.finalOutput &&
                !settled.content.trimEnd().endsWith(result.finalOutput)
                  ? [settled.content.trimEnd(), result.finalOutput]
                      .filter(Boolean)
                      .join("\n\n")
                  : settled.content.trimEnd(),
              state:
                result.status === "completed"
                  ? "done"
                  : result.status === "failed"
                    ? "error"
                    : "cancelled",
              ...(result.error ? { error: result.error.message } : {}),
            };
          });
          setApprovals([]);
        } else {
          setStatus("Reconnecting to progress…");
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 1000),
          );
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
      inFlight.current = false;
      runId.current = undefined;
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  async function cancel() {
    if (!runId.current) {
      controller.current?.abort();
      setBusy(false);
      setPhase("cancelled");
      setStatus("Cancelled");
      setMessages((current) =>
        current.map((message) =>
          message.state === "streaming"
            ? { ...settleActivity(message), state: "cancelled" }
            : message,
        ),
      );
      return;
    }
    try {
      await backendRequest(
        `/agent-runs/${runId.current}/cancel`,
        z.unknown(),
        "POST",
      );
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }
  async function decide(id: string, decision: "approve" | "reject") {
    if (!runId.current) return;
    try {
      await backendRequest(
        `/agent-runs/${runId.current}/approvals/${id}`,
        z.unknown(),
        "POST",
        { decision },
      );
      setApprovals((current) => current.filter((item) => item.id !== id));
      setPhase("running");
      setStatus("Working");
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }
  /** Shows the saved chat of a reopened project and lets the assistant continue its session. */
  function hydrate(saved: SavedConversation) {
    session.current = saved.sessionId;
    sessionProvider.current = saved.provider
      ? `${saved.provider.id}:${saved.provider.model.trim()}:${saved.provider.baseUrl}`
      : "";
    lastPrompt.current = saved.messages[saved.messages.length - 1]?.prompt ?? "";
    setMessages(savedExchangesToMessages(saved.messages));
  }
  /** Sends the most recent prompt again, e.g. after a failure or to get another take. */
  function retry() {
    if (lastPrompt.current) void submit(lastPrompt.current);
  }
  return {
    submit,
    status,
    phase,
    messages,
    busy,
    approvals,
    cancel,
    decide,
    hydrate,
    retry,
    canRetry: !busy && messages.some((message) => message.role === "user"),
    ready: connected && Boolean(provider) && Boolean(model.trim()),
  };
}

export type AssistantRun = ReturnType<typeof useAssistantRun>;
