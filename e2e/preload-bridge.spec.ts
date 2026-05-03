import { expect, test } from "@playwright/test";
import { type AppHandle, launchApp } from "./helpers/electron";

let handle: AppHandle | undefined;

test.afterEach(async () => {
  await handle?.app.close();
});

test("preload bridge exposes electronAPI and core methods", async () => {
  handle = await launchApp();
  const { page } = handle;

  // If preload crashed silently, window.electronAPI is undefined and the
  // renderer shows a white screen. This is the canary for that failure mode.
  const api = await page.evaluate(() => {
    const win = window as unknown as {
      electronAPI?: Record<string, unknown>;
    };
    if (!win.electronAPI) return null;
    return {
      hasSend: typeof win.electronAPI.send === "function",
      hasInvoke: typeof win.electronAPI.invoke === "function",
      hasOn: typeof win.electronAPI.on === "function",
      hasGenerateUuid: typeof win.electronAPI.generateUuid === "function",
    };
  });

  expect(api).not.toBeNull();
  expect(api?.hasSend).toBe(true);
  expect(api?.hasInvoke).toBe(true);
  expect(api?.hasOn).toBe(true);
  expect(api?.hasGenerateUuid).toBe(true);
});

test("app renders initial UI instead of white screen", async () => {
  handle = await launchApp();
  const { page } = handle;

  // The sidebar and settings button should be visible immediately.
  // If preload failed, React crashes before painting anything.
  await expect(page.getByTestId("new-project-btn")).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
});
