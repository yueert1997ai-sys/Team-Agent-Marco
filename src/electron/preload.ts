import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "./ipc-types.js";
import type { CouncilEvent } from "../types.js";

const api: DesktopApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  chooseMeetingDirectory: () => ipcRenderer.invoke("settings:choose-meeting-directory"),
  testProvider: (provider) => ipcRenderer.invoke("providers:test", provider),
  startMeeting: (input) => ipcRenderer.invoke("meeting:start", input),
  listHistory: () => ipcRenderer.invoke("history:list"),
  showItemInFolder: (filePath) => ipcRenderer.invoke("shell:show-item", filePath),
  onMeetingEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: CouncilEvent) => listener(payload);
    ipcRenderer.on("meeting:event", wrapped);
    return () => ipcRenderer.removeListener("meeting:event", wrapped);
  }
};

contextBridge.exposeInMainWorld("teamAgent", api);
