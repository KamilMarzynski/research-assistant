import type { BrowserWindow } from "electron";
import type { DependencyContainer } from "tsyringe";
import { PathJailFactory } from "../agent/path-jail-factory";
import { MEMORY_MANAGER_TOKEN } from "../di/tokens";
import { EventBus } from "../event-bus";
import { AllowlistService } from "../services/AllowlistService";
import { ApprovalPolicyService } from "../services/ApprovalPolicyService";
import { ArtifactService } from "../services/ArtifactService";
import { HomeService } from "../services/HomeService";
import { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager } from "../services/MemoryManager";
import { MessageService } from "../services/MessageService";
import { ObservabilityService } from "../services/ObservabilityService";
import { OutputNotificationService } from "../services/OutputNotificationService";
import { ProjectService } from "../services/ProjectService";
import { ResearchService } from "../services/ResearchService";
import { SettingsService } from "../services/SettingsService";
import { SkillManagementService } from "../services/SkillManagementService";
import { TaskPersistenceService } from "../services/TaskPersistenceService";
import { registerAdminHandlers } from "./admin-handlers";
import { registerArtifactHandlers } from "./artifact-handlers";
import { registerChatHandler } from "./chat-handlers";
import { registerCommandHandlers } from "./command-handlers";
import { registerEventForwarders } from "./event-forwarders";
import { registerProjectHandlers } from "./project-handlers";
import { registerResearchHandlers } from "./research-handlers";
import { SummaryQueue } from "./SummaryQueue";
import { SummaryStreamCoordinator } from "./SummaryStreamCoordinator";
import { SessionManager } from "./session-manager";
import { registerSettingsHandlers } from "./settings-handlers";
import { registerStartupTasks } from "./startup-tasks";

export function registerIpcHandlers(win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const approvalPolicyService = container.resolve(ApprovalPolicyService);
  const artifactService = container.resolve(ArtifactService);
  const settingsService = container.resolve(SettingsService);
  const homeService = container.resolve(HomeService);
  const researchService = container.resolve(ResearchService);
  const memoryManager = container.resolve<IMemoryManager>(MEMORY_MANAGER_TOKEN);
  const eventBus = container.resolve(EventBus);

  const sessionManager = new SessionManager();
  const summaryQueue = new SummaryQueue();
  const summaryStreamCoordinator = new SummaryStreamCoordinator(
    win,
    eventBus,
    summaryQueue,
    sessionManager,
  );
  summaryStreamCoordinator.register();
  const outputNotificationService = container.resolve(OutputNotificationService);
  const memoryFileService = container.resolve(MemoryFileService);
  const allowlistService = container.resolve(AllowlistService);
  const pathJailFactory = container.resolve(PathJailFactory);
  const observabilityService = container.resolve(ObservabilityService);
  const skillManagementService = container.resolve(SkillManagementService);
  const taskPersistenceService = container.resolve(TaskPersistenceService);

  const approvalResolver = registerCommandHandlers(win, allowlistService);

  registerProjectHandlers(win, {
    projectService,
    approvalResolver,
    sessionManager,
    eventBus,
  });
  registerSettingsHandlers(win, { settingsService, sessionManager, projectService });
  registerArtifactHandlers(win, { projectService, artifactService, pathJailFactory });
  registerChatHandler(win, {
    sessionManager,
    settingsService,
    eventBus,
    homeService,
    researchService,
    memoryManager,
    messageService,
    projectService,
    outputNotificationService,
    memoryFileService,
    allowlistService,
    approvalPolicyService,
    observabilityService,
  });
  registerAdminHandlers(win, { homeService, skillManagementService });
  registerResearchHandlers(win, { projectService, researchService, taskPersistenceService });
  registerEventForwarders(win, { eventBus, sessionManager });
  registerStartupTasks({ taskPersistenceService, researchService, eventBus });
}
