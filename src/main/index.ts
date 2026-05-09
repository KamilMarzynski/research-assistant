import "reflect-metadata";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { bootstrap } from "./bootstrap";
import { registerIpcHandlers } from "./ipc-handlers";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    titleBarOverlay: { color: "#00000000", height: 36 },
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const parsed = new URL(rendererUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid ELECTRON_RENDERER_URL protocol: ${parsed.protocol}`);
    }
    win.loadURL(rendererUrl);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(async () => {
  const appContainer = await bootstrap();
  const win = createWindow();
  registerIpcHandlers(win, appContainer);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
