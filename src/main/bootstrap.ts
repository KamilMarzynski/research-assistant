import { join } from "node:path";
import { app } from "electron";
import { container, type DependencyContainer } from "tsyringe";
import { createDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import {
  AGENT_HOME_PATH_TOKEN,
  ARTIFACT_REPO_TOKEN,
  CLOCK_TOKEN,
  DB_TOKEN,
  FALLBACK_MEMORY_PATH_TOKEN,
  MEMORY_FILE_PATH_TOKEN,
  MEMORY_MANAGER_TOKEN,
  MESSAGE_REPO_TOKEN,
  PROJECT_REPO_TOKEN,
  USER_DATA_PATH_TOKEN,
} from "./di/tokens";
import { EventBus } from "./event-bus";
import { getHomePath } from "./paths";
import { DrizzleArtifactRepository } from "./repositories/drizzle/DrizzleArtifactRepository";
import { DrizzleMessageRepository } from "./repositories/drizzle/DrizzleMessageRepository";
import { DrizzleProjectRepository } from "./repositories/drizzle/DrizzleProjectRepository";
import { AllowlistService } from "./services/AllowlistService";
import { ArtifactService } from "./services/ArtifactService";
import { HomeService } from "./services/HomeService";
import { MemoryFileService } from "./services/MemoryFileService";
import { type IMemoryManager, MemoryManager } from "./services/MemoryManager";
import { MessageService } from "./services/MessageService";
import { ObservabilityService } from "./services/ObservabilityService";
import { OutputNotificationService } from "./services/OutputNotificationService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";
import { SkillManagementService } from "./services/SkillManagementService";
import { SkillWatcherService } from "./services/SkillWatcherService";
import { TaskPersistenceService } from "./services/TaskPersistenceService";
import { ToolApprovalService } from "./services/ToolApprovalService";
import { MonotonicClock } from "./utils/time";

export async function bootstrap(): Promise<DependencyContainer> {
  const userDataPath = app.getPath("userData");
  const dbPath = join(userDataPath, "scholar.db");
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const appContainer = container.createChildContainer();

  appContainer.registerInstance(DB_TOKEN, db);
  appContainer.registerInstance(USER_DATA_PATH_TOKEN, userDataPath);

  // Compute home path early — services that inject AGENT_HOME_PATH_TOKEN need it
  // registered before their first resolution.
  const homePath = getHomePath();
  appContainer.registerInstance(AGENT_HOME_PATH_TOKEN, homePath);

  appContainer.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository });
  appContainer.register(MESSAGE_REPO_TOKEN, { useClass: DrizzleMessageRepository });
  appContainer.register(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  appContainer.registerSingleton(ProjectService);
  appContainer.registerSingleton(MessageService);
  appContainer.registerSingleton(ArtifactService);
  appContainer.registerSingleton(ResearchService);
  appContainer.registerSingleton(EventBus);
  appContainer.registerSingleton(SettingsService);
  appContainer.registerSingleton(ObservabilityService);
  appContainer.register<IMemoryManager>(MEMORY_MANAGER_TOKEN, { useClass: MemoryManager });
  appContainer.registerSingleton(TaskPersistenceService);
  appContainer.registerSingleton(SkillManagementService);
  appContainer.registerSingleton(ToolApprovalService);
  appContainer.registerSingleton(HomeService);
  appContainer.registerSingleton(OutputNotificationService);
  appContainer.registerSingleton(AllowlistService);

  appContainer.registerInstance(CLOCK_TOKEN, new MonotonicClock());
  appContainer.registerInstance(MEMORY_FILE_PATH_TOKEN, join(homePath, "app-memory"));
  appContainer.registerInstance(FALLBACK_MEMORY_PATH_TOKEN, homePath);
  appContainer.registerSingleton(MemoryFileService);

  const homeService = appContainer.resolve(HomeService);
  await homeService.ensureDirectories();

  const skillDirs = [join(homePath, "skills")];
  const eventBus = appContainer.resolve(EventBus);
  const skillWatcher = new SkillWatcherService({
    skillDirs,
    emit: (event) => eventBus.emit(event),
    manifestPath: join(homePath, "skills_manifest.json"),
  });
  appContainer.registerInstance(SkillWatcherService, skillWatcher);
  await skillWatcher.start();

  return appContainer;
}
