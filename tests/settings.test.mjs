import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_APP_SETTINGS, applyPublicPatch, mergeStoredSettings, toRuntimeConfig } from "../dist/src/app/settings.js";

test("settings loader restores safe defaults from invalid input", () => {
  const settings = mergeStoredSettings({ gemini: { model: "", baseUrl: "" }, runtime: { timeoutMs: -1, maxRetries: 999 } });
  assert.equal(settings.gemini.model, DEFAULT_APP_SETTINGS.gemini.model);
  assert.equal(settings.runtime.timeoutMs, 90_000);
  assert.equal(settings.runtime.maxRetries, 2);
});

test("public patch updates models and runtime without erasing encrypted values", () => {
  const current = mergeStoredSettings({ gemini: { encryptedApiKey: "encrypted", model: "old", baseUrl: "https://example.com/" } });
  const next = applyPublicPatch(current, { geminiModel: "gemini-3.5-flash", geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/", budgetTokens: 20_000 });
  assert.equal(next.gemini.encryptedApiKey, "encrypted");
  assert.equal(next.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(next.runtime.budgetTokens, 20_000);
});

test("runtime config combines settings with resolved local secrets", () => {
  const runtime = toRuntimeConfig(mergeStoredSettings({}), { geminiApiKey: "local-a", deepSeekApiKey: "local-b" }, "C:/Meetings");
  assert.equal(runtime.geminiApiKey, "local-a");
  assert.equal(runtime.deepSeekApiKey, "local-b");
  assert.equal(runtime.meetingOutputDir, "C:/Meetings");
});

test("settings reject invalid numeric limits", () => {
  assert.throws(() => applyPublicPatch(mergeStoredSettings({}), { maxRetries: 6 }), /maxRetries must be an integer between 0 and 5/);
});
