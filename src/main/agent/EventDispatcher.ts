import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../event-bus";
import type { IMemoryManager } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import type { AgentTracer } from "./AgentTracer";
import { handleStreamChunk } from "./handlers/stream-chunk";
import { handleTurnCompletion } from "./handlers/turn-completion";
import type { SessionState } from "./handlers/types";

export interface EventDispatcherOptions {
  agent: Agent;
  projectId: string;
  eventBus: EventBus;
  messageService: MessageService;
  memoryManager: IMemoryManager;
  observabilityService?: ObservabilityService;
  state: SessionState;
  tracer: AgentTracer;
}

export function subscribeEvents(options: EventDispatcherOptions): () => void {
  const { agent, projectId, eventBus, messageService, memoryManager, state, tracer } = options;

  const ctx = { projectId, eventBus, messageService, memoryManager, state };

  const unsubscribeMain = agent.subscribe(async (event: AgentEvent) => {
    try {
      await handleStreamChunk(event, ctx);
      await handleTurnCompletion(event, ctx);

      if (event.type === "agent_end") {
        tracer.endTurn({ role: "assistant", content: state.assistantContent });
      }
    } catch (err) {
      console.error("[AgentSession] subscriber error:", err);
    }
  });

  const unsubscribeTracer = tracer.subscribeToAgent(agent);

  return () => {
    unsubscribeMain();
    unsubscribeTracer();
  };
}
