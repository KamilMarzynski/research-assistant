import type { EventBus } from "../event-bus";
import type { HomeService } from "../services/HomeService";
import type { ResearchService } from "../services/ResearchService";

export function registerStartupTasks(deps: {
  homeService: HomeService;
  researchService: ResearchService;
  eventBus: EventBus;
}): void {
  const { homeService, researchService, eventBus } = deps;

  // Migrate JSON tasks to DB, then auto-resume in-progress research
  void (async () => {
    try {
      await homeService.migrateTasksFromJson();
    } catch (err) {
      const msg = `Failed to migrate JSON tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({
        type: "startup:error",
        payload: { phase: "migrate-tasks", error: msg },
      });
    }
    try {
      const tasks = await homeService.getInProgressTasks();
      for (const task of tasks) {
        try {
          await researchService.startResearch(
            task.projectId,
            task.projectName,
            task.query,
            task.folderPath,
          );
        } catch (err) {
          const msg = `Failed to resume task ${task.taskId}: ${err instanceof Error ? err.message : String(err)}`;
          console.error("[startup]", msg);
          eventBus.emit({
            type: "startup:error",
            payload: { phase: "resume-task", error: msg },
          });
        }
      }
    } catch (err) {
      const msg = `Failed to load in-progress tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({
        type: "startup:error",
        payload: { phase: "load-tasks", error: msg },
      });
    }
  })();
}
