import { injectable } from "tsyringe";
import type { ResearchTask } from "../../shared/types";
import { NotImplementedError } from "./errors";

@injectable()
export class ResearchService {
  async startResearch(_projectId: string, _query: string): Promise<ResearchTask> {
    throw new NotImplementedError("ResearchService.startResearch", "Run 6");
  }
}
