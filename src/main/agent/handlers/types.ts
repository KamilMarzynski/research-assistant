import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { MessageSegment, ToolCallRecord } from "../../../shared/types";
import type { EventBus } from "../../event-bus";
import type { IMemoryManager } from "../../services/MemoryManager";
import type { MessageService } from "../../services/MessageService";
import type { ObservabilityService } from "../../services/ObservabilityService";

export type PendingToolCall = Omit<ToolCallRecord, "status"> & {
  status: "running" | "done" | "error";
};

/** Mutable state shared between AgentSession, MessagePipeline, and event handlers. Passed by reference. */
export interface SessionState {
  assistantContent: string;
  lastUserContent: string;
  currentTurnId: number;
  savedForTurn: number;
  pendingSkillDeltas: Array<{ skillName: string; summary: string }>;
  pendingToolDescriptions: Map<string, string>;
  pendingToolCalls: PendingToolCall[];
  skillRouterReady: boolean;
  sessionId: string;
  streamingMessageId: string | null;
  streamChunkCount: number;
  segmentLog: MessageSegment[];
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
