import { join } from "node:path";
import { app } from "electron";
import { container, type DependencyContainer } from "tsyringe";
import { createDatabase } from "./db/client";
import { runMigrations } from "./db/migrate";
import { ARTIFACT_REPO_TOKEN, DB_TOKEN, MESSAGE_REPO_TOKEN, PROJECT_REPO_TOKEN } from "./di/tokens";
import { EventBus } from "./event-bus";
import { DrizzleArtifactRepository } from "./repositories/drizzle/DrizzleArtifactRepository";
import { DrizzleMessageRepository } from "./repositories/drizzle/DrizzleMessageRepository";
import { DrizzleProjectRepository } from "./repositories/drizzle/DrizzleProjectRepository";
import { ArtifactService } from "./services/ArtifactService";
import { FileService } from "./services/FileService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";

export async function bootstrap(): Promise<DependencyContainer> {
  const dbPath = join(app.getPath("userData"), "research-assistant.db");
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const appContainer = container.createChildContainer();

  appContainer.registerInstance(DB_TOKEN, db);

  appContainer.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository });
  appContainer.register(MESSAGE_REPO_TOKEN, { useClass: DrizzleMessageRepository });
  appContainer.register(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  appContainer.registerSingleton(ProjectService);
  appContainer.registerSingleton(MessageService);
  appContainer.registerSingleton(ArtifactService);
  appContainer.registerSingleton(ResearchService);
  appContainer.registerSingleton(FileService);
  appContainer.registerSingleton(EventBus);

  return appContainer;
}
