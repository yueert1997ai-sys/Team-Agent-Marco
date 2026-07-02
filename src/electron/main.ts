import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { detectProvider } from "../app/provider-detection.js";
import type { ProviderId, ProviderUpdatePatch, RuntimeSettingsPatch } from "../app/settings.js";
import { ChatService } from "../chat/chat-service.js";
import type { SendChatInput } from "../chat/types.js";
import { SecureSettingsStore } from "./secure-settings-store.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let settingsStore: SecureSettingsStore;
let chatRunning = false;

app.whenReady().then(async () => {
  settingsStore = new SecureSettingsStore(
    app.getPath("userData"),
    path.join(app.getPath("documents"), "Team Agent Marco", "conversations")
  );
  registerIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0b0d12",
    title: "Team Agent Marco",
    webPreferences: {
      preload: path.join(currentDirectory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  void mainWindow.loadFile(path.join(currentDirectory, "../ui/index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function registerIpcHandlers(): void {
  ipcMain.handle("settings:get", () => settingsStore.getPublicSettings());
  ipcMain.handle("providers:detect-and-save", async (_event, apiKey: string) => {
    const detected = await detectProvider(apiKey);
    const settings = await settingsStore.saveProvider(detected.provider, apiKey, detected.defaultModel, detected.baseUrl);
    return { detected, settings };
  });
  ipcMain.handle("providers:remove", (_event, provider: ProviderId) => settingsStore.removeProvider(provider));
  ipcMain.handle("providers:update", (_event, patch: ProviderUpdatePatch) => settingsStore.updateProvider(patch));
  ipcMain.handle("settings:update-runtime", (_event, patch: RuntimeSettingsPatch) => settingsStore.updateRuntime(patch));
  ipcMain.handle("settings:choose-conversation-directory", async () => {
    const options = {
      title: "选择对话记录保存位置",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("chat:send", async (_event, input: SendChatInput) => {
    if (chatRunning) throw new Error("上一条消息仍在处理中。");
    chatRunning = true;
    try {
      const runtime = await settingsStore.getRuntimeConfig();
      const service = new ChatService(runtime);
      return await service.send(input, (event) => mainWindow?.webContents.send("chat:event", event));
    } finally {
      chatRunning = false;
    }
  });
  ipcMain.handle("chat:list", async () => {
    const service = new ChatService(await settingsStore.getRuntimeConfig());
    return service.listConversations();
  });
  ipcMain.handle("chat:get", async (_event, id: string) => {
    const service = new ChatService(await settingsStore.getRuntimeConfig());
    return service.getConversation(id);
  });
}
