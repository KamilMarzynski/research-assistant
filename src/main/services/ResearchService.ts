import { injectable } from "tsyringe";
import type { ResearchTask } from "../../shared/types";
import { NotImplementedError } from "./errors";

@injectable()
export class ResearchService {
  async startResearch(
    _projectId: string,
    _projectName: string,
    _query: string,
    _folderPath: string | null,
  ): Promise<ResearchTask> {
    throw new NotImplementedError("ResearchService.startResearch", "Run 6");
  }
}
