import type { InjectionToken } from "tsyringe";
import type { DrizzleDB } from "../db/client";
import type { IArtifactRepository } from "../repositories/IArtifactRepository";
import type { IMessageRepository } from "../repositories/IMessageRepository";
import type { IProjectRepository } from "../repositories/IProjectRepository";

export const DB_TOKEN: InjectionToken<DrizzleDB> = Symbol("DrizzleDB");
export const PROJECT_REPO_TOKEN: InjectionToken<IProjectRepository> = Symbol("IProjectRepository");
export const MESSAGE_REPO_TOKEN: InjectionToken<IMessageRepository> = Symbol("IMessageRepository");
export const ARTIFACT_REPO_TOKEN: InjectionToken<IArtifactRepository> =
  Symbol("IArtifactRepository");
export const USER_DATA_PATH_TOKEN: InjectionToken<string> = Symbol("userDataPath");
