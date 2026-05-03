import { expect, test } from "@playwright/test";
import { type AppHandle, launchApp } from "./helpers/electron";

let handle: AppHandle | undefined;

test.afterEach(async () => {
  await handle?.app.close();
});

test.skip("simulated TOOL_PENDING shows banner; approve flow hides modal and banner", async () => {
  handle = await launchApp();
  const { page } = handle;

  // Wait for stable state
  await expect(page.getByTestId("new-project-btn")).toBeVisible();

  // Create a project so ChatPanel (and PendingToolBanner) is mounted
  const projectName = `Tool Approval Test ${Date.now()}`;
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

  // Wait for ChatPanel to be visible
  await expect(page.getByTestId("message-input")).toBeVisible();

  // Simulate a TOOL_PENDING event via the preload helper
  await page.evaluate(() => {
    window.electronAPI._simulateEvent?.("TOOL_PENDING", {
      name: "test-tool",
      skillContent: "# Test Skill\nThis is a test skill.",
    });
  });

  // The banner for the pending tool should now be visible
  const banner = page.getByTestId("pending-tool-banner-test-tool");
  await expect(banner).toBeVisible();

  // Click the Review button to open the modal
  await page.getByTestId("review-tool-btn-test-tool").click();

  // The modal should be visible
  const modal = page.getByTestId("pending-tool-modal");
  await expect(modal).toBeVisible();

  // Click Approve — this triggers a real IPC call to main; the handler exists
  // (ipcMain.handle APPROVE_TOOL in ipc-handlers.ts) so it will resolve cleanly.
  await page.getByTestId("approve-tool-btn").click();

  // After approval, the modal should be gone and the banner should disappear
  await expect(modal).not.toBeVisible();
  await expect(banner).not.toBeVisible();
});
