import type { RuntimeConfig } from "../config/runtime.js";
import type { ChatMessage } from "./types.js";
import { postJson } from "../providers/http.js";

export interface TextGenerationResult {
  text: string;
  totalTokens: number;
}

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export async function generateOpenAI(
  runtime: RuntimeConfig,
  messages: ChatMessage[],
  internalNotes: string[]
): Promise<TextGenerationResult> {
  if (!runtime.openAIApiKey) throw new Error("请先在模型设置中添加 OpenAI API Key。GPT-5.5 是固定总控模型。");
  const system = [
    "你是 Team Agent Marco 的总控助手，模型固定为 GPT-5.5。",
    "以普通聊天方式自然回应用户。用户可以随意说话，不需要填写会议议题，也不要使用圆桌会议口吻。",
    "回答要直接、完整、可执行。需要时可以使用内部专家意见，但不要暴露内部讨论过程，不要假装专家意见一定正确。",
    "当信息不足时，根据现有上下文做合理假设并明确说明。"
  ].join("\n");
  const instructions = internalNotes.length > 0
    ? `${system}\n\n以下是辅助模型的内部参考意见，仅供你判断，不要逐条转述：\n\n${internalNotes.join("\n\n")}`
    : system;
  const input = messages.map((message) => ({ role: message.role, content: message.content }));
  const response = await postJson<OpenAIResponse>("openai", `${runtime.openAIBaseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.openAIApiKey}`
    },
    body: JSON.stringify({
      model: "gpt-5.5",
      instructions,
      input,
      reasoning: { effort: "medium" },
      max_output_tokens: runtime.maxOutputTokens
    })
  }, runtime.providerRuntime);
  const text = response.output_text?.trim() || response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.text)
    .map((item) => item.text ?? "")
    .join("")
    .trim() || "";
  if (!text) throw new Error("GPT-5.5 没有返回可显示的内容。");
  return { text, totalTokens: response.usage?.total_tokens ?? 0 };
}

export async function consultGemini(runtime: RuntimeConfig, messages: ChatMessage[]): Promise<TextGenerationResult> {
  if (!runtime.geminiApiKey) return { text: "", totalTokens: 0 };
  const prompt = expertPrompt("你是多模态、资料整理和技术分析顾问。", messages);
  const response = await postJson<GeminiResponse>("gemini", `${runtime.geminiBaseUrl}/models/${encodeURIComponent(runtime.geminiModel)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": runtime.geminiApiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: Math.min(runtime.maxOutputTokens, 1200), temperature: 0.2 }
    })
  }, runtime.providerRuntime);
  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
  return { text, totalTokens: response.usageMetadata?.totalTokenCount ?? 0 };
}

export async function consultDeepSeek(runtime: RuntimeConfig, messages: ChatMessage[]): Promise<TextGenerationResult> {
  if (!runtime.deepSeekApiKey) return { text: "", totalTokens: 0 };
  const prompt = expertPrompt("你是中文产品、逻辑审查和反方分析顾问。", messages);
  const response = await postJson<DeepSeekResponse>("deepseek", `${runtime.deepSeekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtime.deepSeekApiKey}` },
    body: JSON.stringify({
      model: runtime.deepSeekModel,
      messages: [
        { role: "system", content: "你是内部顾问，只给总控模型提供简洁、可靠的分析。" },
        { role: "user", content: prompt }
      ],
      max_tokens: Math.min(runtime.maxOutputTokens, 1200),
      temperature: 0.2,
      stream: false
    })
  }, runtime.providerRuntime);
  const text = response.choices?.[0]?.message?.content?.trim() ?? "";
  return { text, totalTokens: response.usage?.total_tokens ?? 0 };
}

function expertPrompt(role: string, messages: ChatMessage[]): string {
  const recent = messages.slice(-10).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n");
  return `${role}\n请阅读最近对话，只输出给 GPT-5.5 的内部建议：关键判断、风险、遗漏信息和可执行建议。不要直接对用户说话。\n\n${recent}`;
}
