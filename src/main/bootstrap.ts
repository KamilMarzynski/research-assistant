import { join } from "node:path";
import { app } from "electron";
import { container, type DependencyContainer } from "tsyringe";
import { createDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import {
  AGENT_HOME_PATH_TOKEN,
  ARTIFACT_REPO_TOKEN,
  DB_TOKEN,
  MESSAGE_REPO_TOKEN,
  PROJECT_REPO_TOKEN,
  USER_DATA_PATH_TOKEN,
} from "./di/tokens";
import { EventBus } from "./event-bus";
import { DrizzleArtifactRepository } from "./repositories/drizzle/DrizzleArtifactRepository";
import { DrizzleMessageRepository } from "./repositories/drizzle/DrizzleMessageRepository";
import { DrizzleProjectRepository } from "./repositories/drizzle/DrizzleProjectRepository";
import { ArtifactService } from "./services/ArtifactService";
import { HomeService } from "./services/HomeService";
import { MemoryManager } from "./services/MemoryManager";
import { MessageService } from "./services/MessageService";
import { OutputNotificationService } from "./services/OutputNotificationService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";

export async function bootstrap(): Promise<DependencyContainer> {
  const userDataPath = app.getPath("userData");
  const dbPath = join(userDataPath, "research-assistant.db");
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const appContainer = container.createChildContainer();

  appContainer.registerInstance(DB_TOKEN, db);
  appContainer.registerInstance(USER_DATA_PATH_TOKEN, userDataPath);

  appContainer.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository });
  appContainer.register(MESSAGE_REPO_TOKEN, { useClass: DrizzleMessageRepository });
  appContainer.register(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  appContainer.registerSingleton(ProjectService);
  appContainer.registerSingleton(MessageService);
  appContainer.registerSingleton(ArtifactService);
  appContainer.registerSingleton(ResearchService);
  appContainer.registerSingleton(EventBus);
  appContainer.registerSingleton(SettingsService);
  appContainer.registerSingleton(MemoryManager);
  appContainer.registerSingleton(HomeService);
  appContainer.registerSingleton(OutputNotificationService);

  const homeService = appContainer.resolve(HomeService);
  await homeService.ensureDirectories();
  appContainer.registerInstance(AGENT_HOME_PATH_TOKEN, homeService.getHomePath());

  return appContainer;
}
