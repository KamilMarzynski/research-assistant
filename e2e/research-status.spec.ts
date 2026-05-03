import { expect, test } from "@playwright/test";
import { type AppHandle, launchApp } from "./helpers/electron";

let handle: AppHandle | undefined;

test.afterEach(async () => {
  await handle?.app.close();
});

test.skip("simulated RESEARCH_STATUS_UPDATE shows the status bar with the query text", async () => {
  handle = await launchApp();
  const { page } = handle;

  // Wait for the app to reach a stable state
  await expect(page.getByTestId("new-project-btn")).toBeVisible();

  // Create a project so the ChatPanel (and ResearchStatusBar) is mounted
  const projectName = `Research Test ${Date.now()}`;
  await page.getByTestId("new-project-btn").click();

  const nameInput = page.getByPlaceholder("Project name");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(projectName);
  await nameInput.press("Enter");

  // Select the newly created project
  const projectItem = page.locator("[data-testid^='project-item-']", {
    hasText: projectName,
  });
  await expect(projectItem).toBeVisible();
  await projectItem.click();

  // Wait for the ChatPanel to be visible
  await expect(page.getByTestId("message-input")).toBeVisible();

  // Simulate research starting so the bar becomes active
  await page.evaluate(() => {
    window.electronAPI._simulateEvent?.("RESEARCH_STATUS_UPDATE", {
      taskId: "test-task",
      projectId: "test-project",
      status: "started",
      query: "Test query",
    });
  });

  // Simulate a progress event carrying the query text as the message
  await page.evaluate(() => {
    window.electronAPI._simulateEvent?.("RESEARCH_STATUS_UPDATE", {
      taskId: "test-task",
      projectId: "test-project",
      status: "progress",
      message: "Test query",
    });
  });

  // The status bar should now be visible
  const statusBar = page.getByTestId("research-status-bar");
  await expect(statusBar).toBeVisible();

  // And it should display the query text
  await expect(statusBar).toContainText("Test query");
});
