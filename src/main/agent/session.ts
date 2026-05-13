import { randomUUID } from "node:crypto";
import type { EventBus } from "../event-bus";
import type { AllowlistService } from "../services/AllowlistService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import type { ResearchService } from "../services/ResearchService";
import { subscribeEvents } from "./EventDispatcher";
import { MessagePipeline } from "./MessagePipeline";
import type { ModelProvider } from "./model-provider";

export interface AgentSessionOptions {
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryManager: IMemoryManager;
  eventBus: EventBus;
  initialMemoryContext: MemoryContext;
  projectId: string;
  projectName: string;
  folderPath: string | null;
  provider: ModelProvider;
  isFirstRun: boolean;
  systemContext?: string;
  webAccessEnabled?: boolean;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  memoryFileService?: MemoryFileService;
  allowlistService: AllowlistService;
  proposeSkillFn?: (name: string, skillContent: string, script?: string) => Promise<void>;
  observabilityService?: ObservabilityService;
}

export class AgentSession {
  private readonly pipeline: MessagePipeline;

  constructor(options: AgentSessionOptions) {
    const state = {
      assistantContent: "",
      lastUserContent: "",
      currentTurnId: 0,
      savedForTurn: 0,
      processing: false,
      pendingFollowUp: null as string | null,
      pendingSkillDeltas: [] as Array<{ skillName: string; summary: string }>,
      skillRouterReady: false,
      activeTurnSpan: null as import("../services/ObservabilityService").ObservationSpan | null,
      activeGenerationSpan: null as
        | import("../services/ObservabilityService").ObservationSpan
        | null,
      activeToolSpan: null as import("../services/ObservabilityService").ObservationSpan | null,
      sessionId: randomUUID(),
      turnTraceId: null as string | null,
      turnSpanId: null as string | null,
    };

    this.pipeline = new MessagePipeline(options, state);

    subscribeEvents({
      agent: this.pipeline.agent,
      projectId: options.projectId,
      eventBus: options.eventBus,
      messageService: options.messageService,
      memoryManager: options.memoryManager,
      observabilityService: options.observabilityService,
      provider: options.provider,
      state,
    });
  }

  async send(content: string): Promise<void> {
    return this.pipeline.send(content);
  }

  async queueFollowUp(content: string): Promise<void> {
    return this.pipeline.queueFollowUp(content);
  }

  abort(): void {
    this.pipeline.agent.abort();
  }
}
