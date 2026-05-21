import type { EventBus } from "../event-bus";
import type { ResearchService } from "../services/ResearchService";
import type { TaskPersistenceService } from "../services/TaskPersistenceService";

export function registerStartupTasks(deps: {
  taskPersistenceService: TaskPersistenceService;
  researchService: ResearchService;
  eventBus: EventBus;
}): void {
  const { taskPersistenceService, researchService, eventBus } = deps;

  // Migrate JSON tasks to DB, then auto-resume in-progress research.
  // Intentionally non-blocking — startup tasks run in the background
  // and emit errors via EventBus rather than blocking app launch.
  void (async () => {
    try {
      await taskPersistenceService.migrateTasksFromJson();
    } catch (err) {
      const msg = `Failed to migrate JSON tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({
        type: "startup:error",
        payload: { phase: "migrate-tasks", error: msg },
      });
    }
    try {
      const tasks = await taskPersistenceService.getInProgressTasks();
      for (const task of tasks) {
        try {
          await researchService.resumeResearch(task);
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
