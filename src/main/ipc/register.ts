import type { BrowserWindow } from "electron";
import type { DependencyContainer } from "tsyringe";
import { EventBus } from "../event-bus";
import { ArtifactService } from "../services/ArtifactService";
import { HomeService } from "../services/HomeService";
import { MemoryFileService } from "../services/MemoryFileService";
import { MemoryManager } from "../services/MemoryManager";
import { MessageService } from "../services/MessageService";
import { OutputNotificationService } from "../services/OutputNotificationService";
import { ProjectService } from "../services/ProjectService";
import { ResearchService } from "../services/ResearchService";
import { SettingsService } from "../services/SettingsService";
import { registerAdminHandlers } from "./admin-handlers";
import { registerArtifactHandlers } from "./artifact-handlers";
import { registerChatHandler } from "./chat-handlers";
import { registerCommandHandlers } from "./command-handlers";
import { registerEventForwarders } from "./event-forwarders";
import { registerProjectHandlers } from "./project-handlers";
import { registerResearchHandlers } from "./research-handlers";
import { SessionManager } from "./session-manager";
import { registerSettingsHandlers } from "./settings-handlers";
import { registerStartupTasks } from "./startup-tasks";

export function registerIpcHandlers(win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);
  const settingsService = container.resolve(SettingsService);
  const homeService = container.resolve(HomeService);
  const researchService = container.resolve(ResearchService);
  const memoryManager = container.resolve(MemoryManager);
  const eventBus = container.resolve(EventBus);

  const sessionManager = new SessionManager();
  const outputNotificationService = container.resolve(OutputNotificationService);
  const memoryFileService = container.resolve(MemoryFileService);

  registerProjectHandlers(win, { projectService, sessionManager });
  registerSettingsHandlers(win, { settingsService, sessionManager });
  registerArtifactHandlers(win, { projectService, artifactService });
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
  });
  registerAdminHandlers(win, { homeService });
  registerResearchHandlers(win, { projectService, researchService });
  registerCommandHandlers(win);
  registerEventForwarders(win, { eventBus, sessionManager });
  registerStartupTasks({ homeService, researchService, eventBus });
}
