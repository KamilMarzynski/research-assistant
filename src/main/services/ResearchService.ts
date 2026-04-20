import { injectable } from "tsyringe";
import { NotImplementedError } from "./errors";

@injectable()
export class ResearchService {
  async startResearch(
    _projectId: string,
    _projectName: string,
    _query: string,
    _folderPath: string | null,
  ): Promise<{ taskId: string }> {
    throw new NotImplementedError("ResearchService.startResearch", "Run 6");
  }
}
