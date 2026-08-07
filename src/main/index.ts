import "dotenv/config";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { toRuntimeConfig, type SettingsUpdate } from "./config";
import { SettingsStore } from "./services/settings-store";
import { RuntimeManager } from "./services/runtime-manager";
import { LocalApiServer } from "./server";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let runtime: RuntimeManager | undefined;
let server: LocalApiServer | undefined;

function appIconPath() {
  return join(app.getAppPath(), "resources/ava-dock-icon.png");
}

function registerIpc(runtimeManager: RuntimeManager) {
  ipcMain.handle("ava:bootstrap", () => ({
    settings: runtimeManager.getPublicSettings(),
    status: runtimeManager.getStatus(),
  }));
  ipcMain.handle("ava:status", () => runtimeManager.getStatus());
  ipcMain.handle("ava:recheck", async () => {
    await runtimeManager.restart();
    return runtimeManager.getStatus();
  });
  ipcMain.handle("ava:migrate-database", () => runtimeManager.migrateDatabase());
  ipcMain.handle("ava:save-settings", (_event, update: SettingsUpdate) =>
    runtimeManager.saveSettings(update),
  );
  ipcMain.handle("ava:jobs", () => runtimeManager.listJobs());
  ipcMain.handle(
    "ava:run-prompt",
    (_event, input: { prompt: string; workspacePath?: string }) =>
      runtimeManager.enqueuePrompt(input.prompt, input.workspacePath),
  );
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    title: "Ava Agent",
    icon: appIconPath(),
    backgroundColor: "#0b1020",
    webPreferences: {
      preload: join(currentDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await window.loadFile(join(currentDirectory, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath());
  const settingsPath = process.env.AVA_SETTINGS_PATH || join(app.getPath("userData"), "settings.json");
  const store = new SettingsStore(settingsPath);
  runtime = new RuntimeManager(store, app.getAppPath());
  await runtime.initialize();
  registerIpc(runtime);

  const initial = await store.load();
  const config = toRuntimeConfig(initial);
  server = new LocalApiServer(runtime, config.localApiPort, config.localApiToken);
  await server.start();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void Promise.allSettled([server?.stop(), runtime?.stop()]);
});
