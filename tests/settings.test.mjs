import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_APP_SETTINGS,
  applyProviderUpdate,
  applyRuntimePatch,
  mergeStoredSettings,
  toRuntimeConfig
} from "../dist/src/app/settings.js";

test("settings loader restores safe defaults and migrates legacy providers", () => {
  const settings = mergeStoredSettings({
    gemini: { encryptedApiKey: "legacy", model: "", baseUrl: "" },
    runtime: { timeoutMs: -1, maxRetries: 999 }
  });
  assert.equal(settings.providers.openai.model, "gpt-5.5");
  assert.equal(settings.providers.gemini.encryptedApiKey, "legacy");
  assert.equal(settings.providers.gemini.model, DEFAULT_APP_SETTINGS.providers.gemini.model);
  assert.equal(settings.runtime.timeoutMs, 90_000);
  assert.equal(settings.runtime.maxRetries, 2);
});

test("provider update preserves encrypted key and normalizes URL", () => {
  const current = mergeStoredSettings({
    providers: { openai: { encryptedApiKey: "encrypted", model: "old", baseUrl: "https://example.com/" } }
  });
  const next = applyProviderUpdate(current, {
    provider: "openai",
    model: "gpt-5.5",
    baseUrl: "https://api.openai.com/v1/"
  });
  assert.equal(next.providers.openai.encryptedApiKey, "encrypted");
  assert.equal(next.providers.openai.model, "gpt-5.5");
  assert.equal(next.providers.openai.baseUrl, "https://api.openai.com/v1");
});

test("runtime patch updates assistant preferences", () => {
  const next = applyRuntimePatch(mergeStoredSettings({}), {
    consultExperts: false,
    maxOutputTokens: 8_000,
    conversationDirectory: "C:/Chats"
  });
  assert.equal(next.runtime.consultExperts, false);
  assert.equal(next.runtime.maxOutputTokens, 8_000);
  assert.equal(next.runtime.conversationDirectory, "C:/Chats");
});

test("runtime config combines settings with decrypted provider secrets", () => {
  const runtime = toRuntimeConfig(
    mergeStoredSettings({}),
    { openai: "openai-secret", gemini: "gemini-secret", deepseek: "deepseek-secret" },
    "C:/Chats"
  );
  assert.equal(runtime.openAIApiKey, "openai-secret");
  assert.equal(runtime.openAIModel, "gpt-5.5");
  assert.equal(runtime.geminiApiKey, "gemini-secret");
  assert.equal(runtime.deepSeekApiKey, "deepseek-secret");
  assert.equal(runtime.meetingOutputDir, "C:/Chats");
});

test("settings reject invalid numeric limits", () => {
  assert.throws(
    () => applyRuntimePatch(mergeStoredSettings({}), { maxRetries: 6 }),
    /maxRetries must be an integer between 0 and 5/
  );
});
