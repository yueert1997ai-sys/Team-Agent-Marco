import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { defaultMeetingDirectory, startMeeting, type StartMeetingInput } from "../app/meeting-service.js";
import { listMeetingHistory } from "../app/history.js";
import { createConfiguredProviders } from "../providers/factory.js";
import type { AgentCallOptions } from "../types.js";
import { SecureSettingsStore } from "./secure-settings-store.js";
import type { AppSettingsPatch } from "../app/settings.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let settingsStore: SecureSettingsStore;
let meetingRunning = false;

app.whenReady().then(async () => {
  settingsStore = new SecureSettingsStore(
    app.getPath("userData"),
    defaultMeetingDirectory(app.getPath("documents"))
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
    minWidth: 1050,
    minHeight: 700,
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
  ipcMain.handle("settings:save", (_event, patch: AppSettingsPatch) => settingsStore.save(patch));
  ipcMain.handle("settings:choose-meeting-directory", async () => {
    const options = {
      title: "选择会议记录保存位置",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("providers:test", async (_event, providerId: "gemini" | "deepseek") => {
    const runtime = await settingsStore.getRuntimeConfig();
    const provider = createConfiguredProviders(runtime).find((candidate) => candidate.id === providerId);
    if (!provider) throw new Error(`${providerId === "gemini" ? "Gemini" : "DeepSeek"} API Key 尚未配置。`);

    const model = providerId === "gemini" ? runtime.geminiModel : runtime.deepSeekModel;
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean" } }
    };
    const options: AgentCallOptions = {
      label: "连接测试",
      access: "read",
      schema,
      maxOutputTokens: 80
    };
    const startedAt = Date.now();
    const result = await provider.generate<{ ok: boolean }>({
      prompt: "这是连接测试。只返回 JSON：{\"ok\":true}",
      options,
      model
    });
    return {
      provider: providerId,
      ok: result.value.ok === true,
      latencyMs: Date.now() - startedAt,
      model,
      tokens: result.usage?.totalTokens ?? 0
    };
  });
  ipcMain.handle("meeting:start", async (_event, input: StartMeetingInput) => {
    if (meetingRunning) throw new Error("已有一场会议正在进行，请等待它结束。");
    meetingRunning = true;
    try {
      const runtime = await settingsStore.getRuntimeConfig();
      return await startMeeting(input, runtime, (event) => {
        mainWindow?.webContents.send("meeting:event", event);
      });
    } finally {
      meetingRunning = false;
    }
  });
  ipcMain.handle("history:list", async () => {
    const runtime = await settingsStore.getRuntimeConfig();
    return listMeetingHistory(runtime.meetingOutputDir);
  });
  ipcMain.handle("shell:show-item", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
}
