import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchApp } from "./helpers/electron";

let app: ElectronApplication;

test.afterEach(async () => {
  await app.close();
});

test("create a new project and see it in the sidebar", async () => {
  const { app: electronApp, page } = await launchApp();
  app = electronApp;

  const projectName = `Test Project ${Date.now()}`;

  // Click the "New Project" button to reveal the input
  await page.getByTestId("new-project-btn").click();

  // The TextField with placeholder "Project name" should appear with autoFocus
  const nameInput = page.getByPlaceholder("Project name");
  await expect(nameInput).toBeVisible();

  // Type the project name and submit with Enter
  await nameInput.fill(projectName);
  await nameInput.press("Enter");

  // A project list item with the typed name should now appear in the sidebar
  const projectItem = page.locator("[data-testid^='project-item-']", {
    hasText: projectName,
  });
  await expect(projectItem).toBeVisible();
});
