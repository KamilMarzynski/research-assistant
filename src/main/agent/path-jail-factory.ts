import { join } from "node:path";
import { inject, injectable } from "tsyringe";
import type { Project } from "../../shared/types";
import { getScholarHome } from "../paths";
import { AllowlistService } from "../services/AllowlistService";
import { PathJail } from "./path-jail";

@injectable()
export class PathJailFactory {
  constructor(@inject(AllowlistService) private readonly allowlistService: AllowlistService) {}

  create(project: Project): PathJail {
    const projectPath =
      project.projectPath ?? join(getScholarHome(), "projects", project.slug ?? project.id);
    return new PathJail(
      project.id,
      project.slug ?? project.id,
      project.folderPath,
      projectPath,
      this.allowlistService,
    );
  }
}
