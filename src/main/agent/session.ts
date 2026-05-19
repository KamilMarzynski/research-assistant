import { randomUUID } from "node:crypto";
import type { EventBus } from "../event-bus";
import type { AllowlistService } from "../services/AllowlistService";
import type { ApprovalPolicyService } from "../services/ApprovalPolicyService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager, MemoryContext } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import type { ResearchService } from "../services/ResearchService";
import { subscribeEvents } from "./EventDispatcher";
import { MessagePipeline } from "./MessagePipeline";
import type { ModelProvider } from "./model-provider";
import type { ProviderModelMetadata } from "./providers/provider-client.types";

export interface AgentSessionOptions {
  messageService: MessageService;
  homeService: HomeService;
  researchService: ResearchService;
  memoryManager: IMemoryManager;
  eventBus: EventBus;
  initialMemoryContext: MemoryContext;
  projectId: string;
  slug: string;
  projectName: string;
  projectPath: string | null;
  folderPath: string | null;
  provider: ModelProvider;
  resolvedModelMetadata?: ProviderModelMetadata;
  isFirstRun: boolean;
  systemContext?: string;
  webAccessEnabled?: boolean;
  onFileWrite?: (absolutePath: string, relativePath: string, fileName: string) => void;
  memoryFileService?: MemoryFileService;
  allowlistService: AllowlistService;
  approvalPolicyService?: ApprovalPolicyService;
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
      pendingToolDescriptions: new Map<string, string>(),
      pendingToolCalls: [],
      skillRouterReady: false,
      sessionId: randomUUID(),
      streamingMessageId: null,
      streamChunkCount: 0,
    };

    this.pipeline = new MessagePipeline(options, state);

    subscribeEvents({
      agent: this.pipeline.agent,
      projectId: options.projectId,
      eventBus: options.eventBus,
      messageService: options.messageService,
      memoryManager: options.memoryManager,
      observabilityService: options.observabilityService,
      state,
      tracer: this.pipeline.tracer,
    });
  }

  async send(content: string): Promise<void> {
    return this.pipeline.send(content);
  }

  async queueFollowUp(content: string): Promise<void> {
    return this.pipeline.queueFollowUp(content);
  }

  abort(): void {
    this.pipeline.abort();
  }

  isProcessing(): boolean {
    return this.pipeline.isProcessing();
  }
}
