import type { RunEvent } from "./runClient";
import type { ActivityStep, ChatMessage } from "./types";

const TOOL_LABELS: Readonly<Record<string, string>> = {
  "editor.inspect_mesh": "Inspecting mesh geometry",
  "editor.get_context": "Reading the scene",
  "editor.measure": "Measuring the scene",
  "editor.get_scene_summary": "Summarizing the scene",
  "editor.read_branch": "Opening part of the scene",
  "editor.find_repeats": "Looking for repeated parts",
  "editor.query_objects": "Selecting objects",
  "editor.propose_commands": "Planning scene changes",
  "editor.apply_proposal": "Applying scene changes",
  "viewport.capture": "Looking at the scene",
  "modeling.generate_model_plan": "Planning the model",
  "modeling.assess_quality": "Reviewing model quality",
  "modeling.generate_commands": "Calculating scene changes",
};

function humanize(identifier: string): string {
  const words = identifier
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The short text shown in the chat while a tool runs. An unknown tool gets a readable form of its name. */
export function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? humanize(toolName);
}

function readString(payload: RunEvent["payload"], key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(payload: RunEvent["payload"], key: string) {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function addStep(message: ChatMessage, step: Omit<ActivityStep, "id">): ChatMessage {
  return {
    ...message,
    activity: [
      ...message.activity,
      {
        ...step,
        id: `${step.kind}-${message.activity.length}`,
        contentOffset: message.content.length,
      },
    ],
  };
}

function updateLastRunning(
  message: ChatMessage,
  match: (step: ActivityStep) => boolean,
  change: (step: ActivityStep) => ActivityStep,
): ChatMessage {
  let index = message.activity.length - 1;
  while (index >= 0) {
    const step = message.activity[index];
    if (step && step.status === "running" && match(step)) break;
    index -= 1;
  }
  if (index < 0) return message;
  return {
    ...message,
    activity: message.activity.map((step, at) => (at === index ? change(step) : step)),
  };
}

/** Settles any step still marked as running once the run has ended. */
export function settleActivity(message: ChatMessage): ChatMessage {
  if (message.activity.every((step) => step.status !== "running")) return message;
  return {
    ...message,
    activity: message.activity.map((step) => (step.status === "running" ? { ...step, status: "done" } : step)),
  };
}

const FIRST_OUTPUT_EVENTS: ReadonlySet<string> = new Set([
  "agent.message.delta",
  "skill.loaded",
  "tool.started",
  "editor.proposal.created",
  "approval.required",
]);

/** Folds one streamed run event into the assistant message it belongs to. */
export function applyRunEvent(message: ChatMessage, event: RunEvent, now: number = Date.now()): ChatMessage {
  if (message.thinkingMs === undefined && FIRST_OUTPUT_EVENTS.has(event.type))
    return applyEvent({ ...message, thinkingMs: now - message.startedAt }, event);
  return applyEvent(message, event);
}

function applyEvent(message: ChatMessage, event: RunEvent): ChatMessage {
  const { payload } = event;
  switch (event.type) {
    case "agent.message.delta": {
      const delta = readString(payload, "delta");
      return delta === undefined ? message : { ...message, content: message.content + delta };
    }
    case "agent.message.completed":
      // Keeps messages that arrive between tool calls apart as paragraphs.
      return message.content && !message.content.endsWith("\n\n")
        ? { ...message, content: `${message.content}\n\n` }
        : message;
    case "skill.loaded": {
      const skillId = readString(payload, "skillId");
      return skillId === undefined
        ? message
        : addStep(message, {
            kind: "skill",
            label: `Loaded ${humanize(skillId)} skill`,
            status: "done",
          });
    }
    case "tool.started": {
      const toolName = readString(payload, "toolName");
      return toolName === undefined
        ? message
        : addStep(message, {
            kind: "tool",
            toolName,
            label: toolLabel(toolName),
            status: "running",
          });
    }
    case "tool.completed": {
      const toolName = readString(payload, "toolName");
      const durationMs = readNumber(payload, "durationMs");
      return updateLastRunning(
        message,
        (step) => step.kind === "tool" && step.toolName === toolName,
        (step) => ({
          ...step,
          status: "done",
          ...(durationMs === undefined ? {} : { durationMs }),
        }),
      );
    }
    case "tool.failed": {
      const toolName = readString(payload, "toolName");
      const detail = readString(payload, "message");
      return updateLastRunning(
        message,
        (step) => step.kind === "tool" && step.toolName === toolName,
        (step) => ({
          ...step,
          status: "failed",
          ...(detail === undefined ? {} : { detail }),
        }),
      );
    }
    case "editor.proposal.created": {
      const count = readNumber(payload, "commandCount");
      const summary = readString(payload, "summary");
      return addStep(message, {
        kind: "proposal",
        label: count === undefined ? "Proposed scene changes" : `Proposed ${pluralize(count, "scene change")}`,
        ...(summary === undefined ? {} : { detail: summary }),
        status: "done",
      });
    }
    case "viewport.captured": {
      const captureId = readString(payload, "captureId");
      if (captureId === undefined) return message;
      const imagesSent = payload["imagesSent"] !== false;
      // The picture step is the tool call that took them; its pictures are filed in the editor under captureId.
      return updateLastRunning(
        message,
        (step) => step.kind === "tool" && step.toolName === "viewport.capture",
        (step) => ({
          ...step,
          captureId,
          ...(imagesSent
            ? {}
            : { detail: "Pictures are turned off for this model, so the scene was measured, not drawn." }),
        }),
      );
    }
    case "review.started": {
      const attempt = readNumber(payload, "attempt");
      return addStep(message, {
        kind: "review",
        label: attempt !== undefined && attempt > 1 ? "Reviewing the fixes" : "Independent review of the result",
        status: "running",
      });
    }
    case "review.completed": {
      const outcome = readString(payload, "outcome");
      const summary = readString(payload, "summary");
      const count = readNumber(payload, "findingCount");
      return updateLastRunning(
        message,
        (step) => step.kind === "review",
        (step) => ({
          ...step,
          label:
            outcome === "ready"
              ? "Review passed"
              : outcome === "needs_refinement"
                ? `Review found ${count === undefined ? "problems" : pluralize(count, "problem")} to fix`
                : "Review could not judge the result",
          status: outcome === "ready" ? "done" : "failed",
          ...(summary ? { detail: summary } : {}),
        }),
      );
    }
    case "approval.required": {
      const summary = readString(payload, "summary");
      return addStep(message, {
        kind: "approval",
        label: "Waiting for your approval",
        ...(summary === undefined ? {} : { detail: summary }),
        status: "running",
      });
    }
    case "approval.resolved": {
      const approved = readString(payload, "decision") === "approve";
      return updateLastRunning(
        message,
        (step) => step.kind === "approval",
        (step) => ({
          ...step,
          label: approved ? "Changes approved" : "Changes rejected",
          status: approved ? "done" : "failed",
        }),
      );
    }
    default:
      return message;
  }
}
