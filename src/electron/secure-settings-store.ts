import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import {
  DEFAULT_APP_SETTINGS,
  applyProviderUpdate,
  applyRuntimePatch,
  mergeStoredSettings,
  toPublicSettings,
  toRuntimeConfig,
  type ProviderId,
  type ProviderUpdatePatch,
  type PublicAppSettings,
  type ResolvedSecrets,
  type RuntimeSettingsPatch,
  type StoredAppSettings
} from "../app/settings.js";
import type { RuntimeConfig } from "../config/runtime.js";

export class SecureSettingsStore {
  private readonly filePath: string;

  constructor(userDataDirectory: string, private readonly defaultConversationDirectory: string) {
    this.filePath = path.join(userDataDirectory, "settings.json");
  }

  async getPublicSettings(): Promise<PublicAppSettings> {
    const stored = await this.readStored();
    return toPublicSettings(stored, this.defaultConversationDirectory, await this.encryptionAvailable());
  }

  async getRuntimeConfig(): Promise<RuntimeConfig> {
    const stored = await this.readStored();
    const secrets = await this.decryptSecrets(stored);
    return toRuntimeConfig(stored, secrets, this.defaultConversationDirectory);
  }

  async saveProvider(provider: ProviderId, apiKey: string, model?: string, baseUrl?: string): Promise<PublicAppSettings> {
    const key = apiKey.trim();
    if (!key) throw new Error("API Key 不能为空。");
    const current = await this.readStored();
    const next = applyProviderUpdate(current, { provider, ...(model ? { model } : {}), ...(baseUrl ? { baseUrl } : {}) });
    next.providers[provider].encryptedApiKey = await this.encrypt(key);
    await this.writeStored(next);
    return this.getPublicSettings();
  }

  async removeProvider(provider: ProviderId): Promise<PublicAppSettings> {
    const current = await this.readStored();
    delete current.providers[provider].encryptedApiKey;
    await this.writeStored(current);
    return this.getPublicSettings();
  }

  async updateProvider(patch: ProviderUpdatePatch): Promise<PublicAppSettings> {
    const current = applyProviderUpdate(await this.readStored(), patch);
    await this.writeStored(current);
    return this.getPublicSettings();
  }

  async updateRuntime(patch: RuntimeSettingsPatch): Promise<PublicAppSettings> {
    const current = applyRuntimePatch(await this.readStored(), patch);
    await this.writeStored(current);
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
      openai: settings.providers.openai.encryptedApiKey ? await this.decrypt(settings.providers.openai.encryptedApiKey) : "",
      gemini: settings.providers.gemini.encryptedApiKey ? await this.decrypt(settings.providers.gemini.encryptedApiKey) : "",
      deepseek: settings.providers.deepseek.encryptedApiKey ? await this.decrypt(settings.providers.deepseek.encryptedApiKey) : ""
    };
  }

  private async encryptionAvailable(): Promise<boolean> {
    if (typeof safeStorage.isAsyncEncryptionAvailable === "function") return safeStorage.isAsyncEncryptionAvailable();
    return safeStorage.isEncryptionAvailable();
  }

  private async encrypt(value: string): Promise<string> {
    if (typeof safeStorage.encryptStringAsync === "function") return (await safeStorage.encryptStringAsync(value)).toString("base64");
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
