import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { EventBus } from "../../event-bus";
import type { IMemoryManager } from "../../services/MemoryManager";
import type { MessageService } from "../../services/MessageService";
import type { ObservabilityService, ObservationSpan } from "../../services/ObservabilityService";

/** Mutable state shared between AgentSession, MessagePipeline, and event handlers. Passed by reference. */
export interface SessionState {
  assistantContent: string;
  lastUserContent: string;
  currentTurnId: number;
  savedForTurn: number;
  processing: boolean;
  pendingFollowUp: string | null;
  pendingSkillDeltas: Array<{ skillName: string; summary: string }>;
  pendingToolDescriptions: Map<string, string>;
  skillRouterReady: boolean;
  activeTurnSpan: ObservationSpan | null;
  activeGenerationSpan: ObservationSpan | null;
  activeToolSpan: ObservationSpan | null;
  sessionId: string;
  turnTraceId: string | null;
  turnSpanId: string | null;
  streamingMessageId: string | null;
  streamChunkCount: number;
  pendingToolDescriptions: Map<string, string>;
}

/** Dependencies injected into every event handler. */
export interface HandlerContext {
  projectId: string;
  eventBus: EventBus;
  messageService: MessageService;
  memoryManager: IMemoryManager;
  observabilityService?: ObservabilityService;
  state: SessionState;
}

/** Signature for a single event handler. */
export type EventHandler = (event: AgentEvent, ctx: HandlerContext) => Promise<void> | void;
