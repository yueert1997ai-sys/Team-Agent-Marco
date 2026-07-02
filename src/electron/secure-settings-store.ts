import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import {
  DEFAULT_APP_SETTINGS,
  applyPublicPatch,
  mergeStoredSettings,
  toRuntimeConfig,
  type AppSettingsPatch,
  type PublicAppSettings,
  type ResolvedSecrets,
  type StoredAppSettings
} from "../app/settings.js";
import type { RuntimeConfig } from "../config/runtime.js";

export class SecureSettingsStore {
  private readonly filePath: string;

  constructor(
    userDataDirectory: string,
    private readonly defaultMeetingOutputDir: string
  ) {
    this.filePath = path.join(userDataDirectory, "settings.json");
  }

  async getPublicSettings(): Promise<PublicAppSettings> {
    const stored = await this.readStored();
    return {
      gemini: {
        model: stored.gemini.model,
        baseUrl: stored.gemini.baseUrl,
        apiKeyConfigured: Boolean(stored.gemini.encryptedApiKey)
      },
      deepSeek: {
        model: stored.deepSeek.model,
        baseUrl: stored.deepSeek.baseUrl,
        apiKeyConfigured: Boolean(stored.deepSeek.encryptedApiKey)
      },
      timeoutMs: stored.runtime.timeoutMs,
      maxRetries: stored.runtime.maxRetries,
      retryBaseDelayMs: stored.runtime.retryBaseDelayMs,
      budgetTokens: stored.runtime.budgetTokens,
      maxOutputTokens: stored.runtime.maxOutputTokens,
      meetingOutputDir: stored.runtime.meetingOutputDir || this.defaultMeetingOutputDir,
      encryptionAvailable: await this.encryptionAvailable()
    };
  }

  async getRuntimeConfig(): Promise<RuntimeConfig> {
    const stored = await this.readStored();
    const secrets = await this.decryptSecrets(stored);
    return toRuntimeConfig(stored, secrets, this.defaultMeetingOutputDir);
  }

  async save(patch: AppSettingsPatch): Promise<PublicAppSettings> {
    const current = await this.readStored();
    const next = applyPublicPatch(current, patch);

    if (patch.clearGeminiApiKey) delete next.gemini.encryptedApiKey;
    else if (patch.geminiApiKey?.trim()) next.gemini.encryptedApiKey = await this.encrypt(patch.geminiApiKey.trim());

    if (patch.clearDeepSeekApiKey) delete next.deepSeek.encryptedApiKey;
    else if (patch.deepSeekApiKey?.trim()) next.deepSeek.encryptedApiKey = await this.encrypt(patch.deepSeekApiKey.trim());

    await this.writeStored(next);
    return this.getPublicSettings();
  }

  private async readStored(): Promise<StoredAppSettings> {
    try {
      return mergeStoredSettings(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if (isMissingFile(error)) return structuredClone(DEFAULT_APP_SETTINGS);
      if (error instanceof SyntaxError) return structuredClone(DEFAULT_APP_SETTINGS);
      throw error;
    }
  }

  private async writeStored(settings: StoredAppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  private async decryptSecrets(settings: StoredAppSettings): Promise<ResolvedSecrets> {
    return {
      geminiApiKey: settings.gemini.encryptedApiKey ? await this.decrypt(settings.gemini.encryptedApiKey) : "",
      deepSeekApiKey: settings.deepSeek.encryptedApiKey ? await this.decrypt(settings.deepSeek.encryptedApiKey) : ""
    };
  }

  private async encryptionAvailable(): Promise<boolean> {
    if (typeof safeStorage.isAsyncEncryptionAvailable === "function") {
      return safeStorage.isAsyncEncryptionAvailable();
    }
    return safeStorage.isEncryptionAvailable();
  }

  private async encrypt(value: string): Promise<string> {
    if (typeof safeStorage.encryptStringAsync === "function") {
      return (await safeStorage.encryptStringAsync(value)).toString("base64");
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法使用本机安全存储。");
    return safeStorage.encryptString(value).toString("base64");
  }

  private async decrypt(value: string): Promise<string> {
    const encrypted = Buffer.from(value, "base64");
    if (typeof safeStorage.decryptStringAsync === "function") {
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      return decrypted.result;
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法解密已保存的 API Key。");
    return safeStorage.decryptString(encrypted);
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
