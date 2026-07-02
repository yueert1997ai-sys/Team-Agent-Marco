import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "./ipc-types.js";
import type { ChatEvent } from "../chat/types.js";

const api: DesktopApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  detectAndSaveApiKey: (apiKey) => ipcRenderer.invoke("providers:detect-and-save", apiKey),
  removeProvider: (provider) => ipcRenderer.invoke("providers:remove", provider),
  updateProvider: (patch) => ipcRenderer.invoke("providers:update", patch),
  updateRuntime: (patch) => ipcRenderer.invoke("settings:update-runtime", patch),
  chooseConversationDirectory: () => ipcRenderer.invoke("settings:choose-conversation-directory"),
  sendChat: (input) => ipcRenderer.invoke("chat:send", input),
  listConversations: () => ipcRenderer.invoke("chat:list"),
  getConversation: (id) => ipcRenderer.invoke("chat:get", id),
  onChatEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ChatEvent) => listener(payload);
    ipcRenderer.on("chat:event", wrapped);
    return () => ipcRenderer.removeListener("chat:event", wrapped);
  }
};

contextBridge.exposeInMainWorld("teamAgent", api);
