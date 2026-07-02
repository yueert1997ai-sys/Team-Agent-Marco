import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatService } from "../dist/src/chat/chat-service.js";

function runtime(directory, overrides = {}) {
  return {
    openAIApiKey: "openai-key",
    openAIModel: "gpt-5.5",
    openAIBaseUrl: "https://api.openai.com/v1",
    geminiApiKey: "",
    geminiModel: "gemini-3.5-flash",
    geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    deepSeekApiKey: "",
    deepSeekModel: "deepseek-chat",
    deepSeekBaseUrl: "https://api.deepseek.com",
    providerRuntime: { timeoutMs: 5000, maxRetries: 0, retryBaseDelayMs: 100 },
    budgetTokens: 24000,
    maxOutputTokens: 4000,
    meetingOutputDir: directory,
    consultExperts: true,
    ...overrides
  };
}

test("GPT-5.5 remains the mandatory final responder", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "team-chat-"));
  try {
    const service = new ChatService(runtime(dir, { openAIApiKey: "" }));
    await assert.rejects(service.send({ message: "你好" }), /GPT-5\.5 是固定总控/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normal chat sends user text to GPT-5.5 and persists conversation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "team-chat-"));
  try {
    let receivedMessages;
    const service = new ChatService(runtime(dir), {
      generateOpenAI: async (_runtime, messages, notes) => {
        receivedMessages = structuredClone(messages);
        assert.deepEqual(notes, []);
        return { text: "这是普通聊天回复", totalTokens: 42 };
      },
      randomId: (() => { let i = 0; return () => `id-${++i}`; })(),
      now: () => new Date("2026-07-02T00:00:00.000Z")
    });
    const output = await service.send({ message: "我今天想聊点别的" });
    assert.equal(receivedMessages.at(-1).content, "我今天想聊点别的");
    assert.equal(output.assistantMessage.content, "这是普通聊天回复");
    assert.equal((await service.listConversations()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("optional auxiliary models stay internal and GPT-5.5 produces the visible answer", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "team-chat-"));
  try {
    const events = [];
    const service = new ChatService(runtime(dir, { geminiApiKey: "g", deepSeekApiKey: "d" }), {
      consultGemini: async () => ({ text: "Gemini 内部建议", totalTokens: 10 }),
      consultDeepSeek: async () => ({ text: "DeepSeek 内部建议", totalTokens: 11 }),
      generateOpenAI: async (_runtime, _messages, notes) => {
        assert.equal(notes.length, 2);
        assert.match(notes.join("\n"), /Gemini 内部建议/);
        return { text: "GPT-5.5 最终回答", totalTokens: 20 };
      }
    });
    const output = await service.send({ message: "帮我判断一下" }, (event) => events.push(event));
    assert.equal(output.assistantMessage.content, "GPT-5.5 最终回答");
    assert.deepEqual(output.consultedProviders.sort(), ["DeepSeek", "Gemini"]);
    assert.equal(output.usageTokens, 41);
    assert.ok(events.some((event) => event.type === "status" && event.status === "consulting"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
