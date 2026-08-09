import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ava", {
  bootstrap: () => ipcRenderer.invoke("ava:bootstrap"),
  status: () => ipcRenderer.invoke("ava:status"),
  recheck: () => ipcRenderer.invoke("ava:recheck"),
  migrateDatabase: () => ipcRenderer.invoke("ava:migrate-database"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("ava:save-settings", settings),
  jobs: () => ipcRenderer.invoke("ava:jobs"),
  chatHistory: (limit?: number) => ipcRenderer.invoke("ava:chat-history", limit),
  sendChat: (message: string) => ipcRenderer.invoke("ava:chat-send", message),
  activity: (page: number, pageSize: number) =>
    ipcRenderer.invoke("ava:activity", { page, pageSize }),
  memories: () => ipcRenderer.invoke("ava:memories"),
  deleteMemory: (id: string) => ipcRenderer.invoke("ava:memory-delete", id),
  runPrompt: (prompt: string, workspacePath?: string) =>
    ipcRenderer.invoke("ava:run-prompt", { prompt, workspacePath }),
});
