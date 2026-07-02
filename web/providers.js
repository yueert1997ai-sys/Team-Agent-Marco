import { readProviderSecret } from "./storage.js";

export const OPENAI_MODEL = "gpt-5.5";
export const PROVIDER_DEFAULTS = {
  openai: { id: "openai", label: "OpenAI", model: OPENAI_MODEL, baseUrl: "https://api.openai.com/v1" },
  gemini: { id: "gemini", label: "Google Gemini", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  deepseek: { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" }
};

export async function detectProvider(key, timeoutMs) {
  const order = key.startsWith("AIza") ? ["gemini", "openai", "deepseek"] : ["openai", "deepseek", "gemini"];
  for (const id of order) {
    try {
      const result = await probeProvider(id, key, timeoutMs);
      if (result) return result;
    } catch (error) {
      if (String(error?.message || "").includes("没有 GPT-5.5 权限")) throw error;
    }
  }
  throw new Error("无法识别这个 Key。请确认它属于 OpenAI、Gemini 或 DeepSeek，并且仍然有效。若浏览器提示跨域错误，请改用桌面版或后续接入安全后端。");
}

async function probeProvider(id, key, timeoutMs) {
  const provider = PROVIDER_DEFAULTS[id];
  if (id === "gemini") {
    const response = await fetchWithTimeout(`${provider.baseUrl}/models?key=${encodeURIComponent(key)}`, { method: "GET" }, timeoutMs);
    if (!response.ok) return null;
    const data = await response.json();
    const names = (data.models || []).map((item) => String(item.name || "").replace("models/", ""));
    const model = names.find((name) => /flash/i.test(name)) || provider.model;
    return { ...provider, model };
  }
  const response = await fetchWithTimeout(`${provider.baseUrl}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` }
  }, timeoutMs);
  if (!response.ok) return null;
  if (id === "openai") {
    const data = await response.json();
    if (!(data.data || []).some((model) => model.id === OPENAI_MODEL)) {
      throw new Error("这个 OpenAI Key 当前没有 GPT-5.5 权限。");
    }
  }
  return { ...provider };
}

export async function callOpenAI({ provider, messages, internalNotes, preferences }) {
  const apiKey = await readProviderSecret("openai", "OpenAI");
  const instructions = [
    "你是 Team Agent Marco 的总控助手，模型固定为 GPT-5.5。",
    "以普通聊天方式自然回应用户，不要使用圆桌会议口吻。",
    "回答直接、完整、可执行。辅助模型意见只作为内部参考，不要逐条暴露内部讨论。",
    internalNotes.length ? `内部参考：\n${internalNotes.join("\n\n")}` : ""
  ].filter(Boolean).join("\n\n");
  const response = await fetchWithTimeout(`${provider.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions,
      input: messages.map((message) => ({ role: message.role, content: message.content })),
      reasoning: { effort: preferences.reasoningEffort },
      max_output_tokens: preferences.maxOutputTokens
    })
  }, preferences.timeoutMs);
  const data = await parseResponse(response, "OpenAI");
  const text = data.output_text?.trim() || (data.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("GPT-5.5 没有返回可显示的内容。");
  return { text, usage: data.usage?.total_tokens || 0 };
}

export async function consultProvider(provider, messages, timeoutMs) {
  const apiKey = await readProviderSecret(provider.id, provider.label);
  const recent = messages.slice(-10)
    .map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`)
    .join("\n\n");
  const prompt = `你是 GPT-5.5 的后台顾问。阅读最近对话，只给出关键判断、风险、遗漏和可执行建议，不要直接对用户说话。\n\n${recent}`;
  if (provider.id === "gemini") {
    const response = await fetchWithTimeout(`${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200, temperature: 0.2 }
      })
    }, timeoutMs);
    const data = await parseResponse(response, "Gemini");
    return { text: data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "" };
  }
  const response = await fetchWithTimeout(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1200,
      temperature: 0.2,
      stream: false
    })
  }, timeoutMs);
  const data = await parseResponse(response, "DeepSeek");
  return { text: data.choices?.[0]?.message?.content?.trim() || "" };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("请求超时。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(response, label) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${label} 请求失败（HTTP ${response.status}）：${data.error?.message || data.message || text.slice(0, 300)}`);
  }
  return data;
}
