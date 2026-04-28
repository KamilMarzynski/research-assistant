import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "path";

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
}

export async function launchApp(): Promise<AppHandle> {
  const app = await electron.launch({
    args: [path.join(process.cwd(), "out/main/index.js")],
    env: { ...process.env, PLAYWRIGHT_TEST: "1" },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
