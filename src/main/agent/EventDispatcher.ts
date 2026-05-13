import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../event-bus";
import type { IMemoryManager } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import { handleGenerationSpan } from "./handlers/generation-span";
import { handleStreamChunk } from "./handlers/stream-chunk";
import { handleToolSpan } from "./handlers/tool-span";
import { handleTurnCompletion } from "./handlers/turn-completion";
import type { SessionState } from "./handlers/types";
import type { ModelProvider } from "./model-provider";

export interface EventDispatcherOptions {
  agent: Agent;
  projectId: string;
  eventBus: EventBus;
  messageService: MessageService;
  memoryManager: IMemoryManager;
  observabilityService?: ObservabilityService;
  provider: ModelProvider;
  state: SessionState;
}

export function subscribeEvents(options: EventDispatcherOptions): () => void {
  const {
    agent,
    projectId,
    eventBus,
    messageService,
    memoryManager,
    observabilityService,
    provider,
    state,
  } = options;

  const ctx = { projectId, eventBus, messageService, memoryManager, observabilityService, state };

  return agent.subscribe(async (event: AgentEvent) => {
    try {
      await handleStreamChunk(event, ctx);
      await handleTurnCompletion(event, ctx);
      await handleGenerationSpan(event, state, observabilityService, provider);
      await handleToolSpan(event, state, observabilityService);
    } catch (err) {
      console.error("[AgentSession] subscriber error:", err);
    }
  });
}
