import { expect, test } from "@playwright/test";
import { type AppHandle, launchApp } from "./helpers/electron";

let handle: AppHandle | undefined;

test.afterEach(async () => {
  await handle?.app.close();
});

test("send a message and see the user bubble in the message list", async () => {
  handle = await launchApp();
  const { page } = handle;

  // Wait for the app to reach a stable state
  await expect(page.getByTestId("new-project-btn")).toBeVisible();

  // Skip if no API key is configured
  const raw = await page.evaluate(() => window.electronAPI.invoke("GET_SETTINGS"));
  const hasApiKey =
    typeof raw === "object" && raw !== null && "hasApiKey" in raw && raw.hasApiKey === true;
  test.skip(!hasApiKey, "No API key configured");
  if (!hasApiKey) return;

  // Create a project so the chat panel becomes available
  const projectName = `Send Test ${Date.now()}`;
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

  // Wait for the message input to appear
  const messageInput = page.getByTestId("message-input");
  await expect(messageInput).toBeVisible();

  // Type and send a message
  const messageText = "Hello from Playwright";
  await messageInput.fill(messageText);
  await page.getByTestId("send-btn").click();

  // The user message bubble should appear immediately
  const bubble = page.locator("[data-testid='message-bubble']", {
    hasText: messageText,
  });
  await expect(bubble).toBeVisible();
  // Streaming cursor assertion omitted — requires a live LLM connection
});
