import type { AgentEvent } from "@agentfront/types";

export type EventListener = (event: AgentEvent) => void;

export class AgentEventBus {
  readonly #listeners = new Set<EventListener>();

  publish(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}
