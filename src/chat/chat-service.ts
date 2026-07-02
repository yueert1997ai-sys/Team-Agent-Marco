import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "../config/runtime.js";
import { ChatStore } from "./chat-store.js";
import { consultDeepSeek, consultGemini, generateOpenAI, type TextGenerationResult } from "./provider-clients.js";
import type { ChatConversation, ChatEvent, ChatMessage, SendChatInput, SendChatOutput } from "./types.js";

export interface ChatServiceDependencies {
  generateOpenAI?: typeof generateOpenAI;
  consultGemini?: typeof consultGemini;
  consultDeepSeek?: typeof consultDeepSeek;
  now?: () => Date;
  randomId?: () => string;
}

export class ChatService {
  private readonly generateOpenAI: typeof generateOpenAI;
  private readonly consultGemini: typeof consultGemini;
  private readonly consultDeepSeek: typeof consultDeepSeek;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(private readonly runtime: RuntimeConfig, dependencies: ChatServiceDependencies = {}) {
    this.generateOpenAI = dependencies.generateOpenAI ?? generateOpenAI;
    this.consultGemini = dependencies.consultGemini ?? consultGemini;
    this.consultDeepSeek = dependencies.consultDeepSeek ?? consultDeepSeek;
    this.now = dependencies.now ?? (() => new Date());
    this.randomId = dependencies.randomId ?? randomUUID;
  }

  async send(input: SendChatInput, onEvent: (event: ChatEvent) => void = () => undefined): Promise<SendChatOutput> {
    const content = input.message.trim();
    if (!content) throw new Error("请输入内容。");
    if (!this.runtime.openAIApiKey) {
      throw new Error("GPT-5.5 是固定总控。请先在模型设置中添加 OpenAI API Key。");
    }

    const store = new ChatStore(this.runtime.meetingOutputDir);
    const now = this.now().toISOString();
    const conversation = input.conversationId
      ? await store.get(input.conversationId)
      : null;
    const active = conversation ?? createConversation(this.randomId(), content, now);
    const userMessage: ChatMessage = { id: this.randomId(), role: "user", content, createdAt: now };
    active.messages.push(userMessage);
    active.updatedAt = now;

    onEvent({ type: "status", status: "thinking", text: "GPT-5.5 正在理解你的问题" });
    const consultedProviders: string[] = [];
    const internalNotes: string[] = [];
    let usageTokens = 0;

    if (this.runtime.consultExperts && (this.runtime.geminiApiKey || this.runtime.deepSeekApiKey)) {
      onEvent({ type: "status", status: "consulting", text: "正在调用辅助模型补充观点" });
      const tasks: Array<Promise<{ provider: string; result: TextGenerationResult } | null>> = [];
      if (this.runtime.geminiApiKey) {
        tasks.push(this.safeConsult("Gemini", () => this.consultGemini(this.runtime, active.messages)));
      }
      if (this.runtime.deepSeekApiKey) {
        tasks.push(this.safeConsult("DeepSeek", () => this.consultDeepSeek(this.runtime, active.messages)));
      }
      const results = await Promise.all(tasks);
      for (const item of results) {
        if (!item || !item.result.text) continue;
        consultedProviders.push(item.provider);
        internalNotes.push(`${item.provider}：${item.result.text}`);
        usageTokens += item.result.totalTokens;
        onEvent({ type: "provider_completed", provider: item.provider });
      }
    }

    onEvent({ type: "status", status: "answering", text: "GPT-5.5 正在组织最终回复" });
    const mainResult = await this.generateOpenAI(this.runtime, active.messages, internalNotes);
    usageTokens += mainResult.totalTokens;
    const assistantMessage: ChatMessage = {
      id: this.randomId(),
      role: "assistant",
      content: mainResult.text,
      createdAt: this.now().toISOString()
    };
    active.messages.push(assistantMessage);
    active.updatedAt = assistantMessage.createdAt;

    onEvent({ type: "status", status: "saving", text: "正在保存对话" });
    await store.save(active);
    onEvent({ type: "completed", conversationId: active.id });
    return { conversation: active, assistantMessage, consultedProviders, usageTokens };
  }

  async listConversations() {
    return new ChatStore(this.runtime.meetingOutputDir).list();
  }

  async getConversation(id: string) {
    return new ChatStore(this.runtime.meetingOutputDir).get(id);
  }

  private async safeConsult(provider: string, operation: () => Promise<TextGenerationResult>) {
    try {
      return { provider, result: await operation() };
    } catch {
      return null;
    }
  }
}

function createConversation(id: string, firstMessage: string, now: string): ChatConversation {
  const title = firstMessage.replace(/\s+/g, " ").slice(0, 32) || "新对话";
  return { id, title, createdAt: now, updatedAt: now, messages: [] };
}
