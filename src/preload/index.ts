import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ava", {
  bootstrap: () => ipcRenderer.invoke("ava:bootstrap"),
  status: () => ipcRenderer.invoke("ava:status"),
  recheck: () => ipcRenderer.invoke("ava:recheck"),
  migrateDatabase: () => ipcRenderer.invoke("ava:migrate-database"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("ava:save-settings", settings),
  jobs: () => ipcRenderer.invoke("ava:jobs"),
  runPrompt: (prompt: string, workspacePath?: string) =>
    ipcRenderer.invoke("ava:run-prompt", { prompt, workspacePath }),
});
