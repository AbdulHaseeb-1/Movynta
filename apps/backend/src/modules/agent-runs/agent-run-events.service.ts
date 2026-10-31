import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Injectable } from "@nestjs/common";
import { AgentRunRepository } from "./agent-run.repository.js";
import type { AgentRunEvent, AgentRunEventPayloads, AgentRunEventSink, AgentRunEventType } from "./agent-run.events.js";

/**
 * Persists every run event (for replay after reconnects) and publishes it to
 * live subscribers. Events are stored before they are published.
 */
@Injectable()
export class AgentRunEventsService {
  private readonly hub = new EventEmitter();

  constructor(private readonly repository: AgentRunRepository) {
    this.hub.setMaxListeners(0);
  }

  publish<T extends AgentRunEventType>(runId: string, type: T, payload: AgentRunEventPayloads[T]): AgentRunEvent {
    const event = this.repository.appendEvent(
      runId,
      `evt_${randomUUID()}`,
      type,
      new Date().toISOString(),
      JSON.stringify(payload),
    );
    this.hub.emit(runId, event);
    return event;
  }

  replay(runId: string, afterSeq: number): AgentRunEvent[] {
    return this.repository.listEvents(runId, afterSeq);
  }

  subscribe(runId: string, listener: (event: AgentRunEvent) => void): () => void {
    this.hub.on(runId, listener);
    return () => {
      this.hub.off(runId, listener);
    };
  }

  sinkFor(runId: string): AgentRunEventSink {
    return { emit: (type, payload) => void this.publish(runId, type, payload) };
  }
}
