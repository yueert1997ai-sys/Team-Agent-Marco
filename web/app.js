import {
  initializeStorage,
  getConversation,
  listConversations,
  loadPreferences,
  loadProviders,
  removeProviderSecret,
  saveConversation,
  savePreferences,
  saveProviderSecret,
  saveProviders
} from "./storage.js";
import {
  OPENAI_MODEL,
  callOpenAI,
  consultProvider,
  detectProvider
} from "./providers.js";

let preferences;
let providers = [];
let activeConversationId = null;
let sending = false;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  preferences = await loadPreferences();
  providers = await loadProviders();
  bindEvents();
  renderSettings();
  await loadConversationList();
  resizeInput();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => undefined);
});

function bindEvents() {
  $("newChatButton").onclick = newChat;
  $("openSettingsButton").onclick = () => showPage("settings");
  $("backToChatButton").onclick = () => showPage("chat");
  $("chatForm").onsubmit = sendMessage;
  $("chatInput").oninput = resizeInput;
  $("chatInput").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("chatForm").requestSubmit();
    }
  };
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  $("toggleKeyButton").onclick = () => {
    const input = $("universalApiKey");
    input.type = input.type === "password" ? "text" : "password";
    $("toggleKeyButton").textContent = input.type === "password" ? "显示" : "隐藏";
  };
  $("detectKeyButton").onclick = detectAndSaveKey;
  $("savePreferencesButton").onclick = persistPreferences;
}

function showPage(page) {
  $("chatPage").classList.toggle("active", page === "chat");
  $("settingsPage").classList.toggle("active", page === "settings");
}

function fillSuggestion(text) {
  $("chatInput").value = text;
  resizeInput();
  $("chatInput").focus();
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text || sending) return;
  const openAI = providers.find((provider) => provider.id === "openai");
  if (!openAI) {
    showPage("settings");
    toast("请先添加 OpenAI API Key，GPT-5.5 才能回答。", true);
    return;
  }

  sending = true;
  $("sendButton").disabled = true;
  $("welcome")?.classList.add("hidden");
  const conversation = await getOrCreateConversation(text);
  const userMessage = createMessage("user", text);
  conversation.messages.push(userMessage);
  conversation.updatedAt = userMessage.createdAt;
  appendMessage(userMessage);
  $("chatInput").value = "";
  resizeInput();
  setStatus("GPT-5.5 正在理解你的问题");
  const thinking = appendThinking();

  try {
    const internalNotes = [];
    const consulted = [];
    if (preferences.consultExperts) {
      const experts = providers.filter((provider) => provider.id !== "openai");
      if (experts.length) {
        setStatus("辅助模型正在后台补充意见");
        const results = await Promise.all(experts.map((provider) => consultProvider(provider, conversation.messages, preferences.timeoutMs).catch(() => null)));
        results.forEach((result, index) => {
          if (!result?.text) return;
          internalNotes.push(`${experts[index].label}：${result.text}`);
          consulted.push(experts[index].label);
        });
      }
    }

    setStatus("GPT-5.5 正在组织最终回复");
    const final = await callOpenAI({ provider: openAI, messages: conversation.messages, internalNotes, preferences });
    const assistantMessage = createMessage("assistant", final.text);
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = assistantMessage.createdAt;
    await saveConversation(conversation);
    thinking.remove();
    appendMessage(assistantMessage, consulted, final.usage);
    $("conversationTitle").textContent = conversation.title;
    setStatus(consulted.length ? `GPT-5.5 已参考 ${consulted.join("、")}` : "GPT-5.5 已回答");
    await loadConversationList();
  } catch (error) {
    thinking.remove();
    appendMessage(createMessage("assistant", `运行失败：${readError(error)}`));
    setStatus("发送失败");
  } finally {
    sending = false;
    $("sendButton").disabled = false;
    $("chatInput").focus();
  }
}

async function detectAndSaveKey() {
  const key = $("universalApiKey").value.trim();
  if (!key) return showDetectMessage("请先粘贴 API Key。", true);
  const button = $("detectKeyButton");
  button.disabled = true;
  button.textContent = "正在识别…";
  try {
    const detected = await detectProvider(key, preferences.timeoutMs);
    await saveProviderSecret(detected.id, key, $("rememberKey").checked);
    providers = [...providers.filter((provider) => provider.id !== detected.id), detected];
    await saveProviders(providers);
    $("universalApiKey").value = "";
    showDetectMessage(`已识别为 ${detected.label}，并保存到当前浏览器。`);
    renderProviders();
    renderConnectionSummary();
    toast(`${detected.label} 已连接`);
  } catch (error) {
    showDetectMessage(readError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "识别并保存";
  }
}

async function persistPreferences() {
  preferences = {
    ...preferences,
    consultExperts: $("consultExperts").checked,
    maxOutputTokens: clampInteger($("maxOutputTokens").value, 100, 128000, 4000),
    reasoningEffort: $("reasoningEffort").value,
    timeoutMs: clampInteger($("timeoutMs").value, 5000, 600000, 120000)
  };
  await savePreferences(preferences);
  toast("聊天偏好已保存");
}

function renderSettings() {
  $("consultExperts").checked = preferences.consultExperts;
  $("maxOutputTokens").value = preferences.maxOutputTokens;
  $("reasoningEffort").value = preferences.reasoningEffort;
  $("timeoutMs").value = preferences.timeoutMs;
  renderProviders();
  renderConnectionSummary();
}

function renderProviders() {
  const box = $("providerList");
  if (!providers.length) {
    box.innerHTML = `<div class="inline-message error">还没有连接模型。请先添加 OpenAI Key。</div>`;
    return;
  }
  box.innerHTML = providers.map((provider) => `<div class="provider-row"><div class="provider-title"><div class="provider-icon">${provider.id === "openai" ? "O" : provider.id === "gemini" ? "G" : "D"}</div><div><strong>${escapeHtml(provider.label)}${provider.id === "openai" ? " · 总控" : " · 辅助"}</strong><small>${provider.id === "openai" ? "固定使用 GPT-5.5 最终回答" : "后台提供内部参考"}</small></div></div>${provider.id === "openai" ? `<div class="fixed-model">${OPENAI_MODEL}</div>` : `<input class="provider-model" data-provider="${provider.id}" value="${escapeHtml(provider.model)}">`}<button class="danger remove-provider" data-provider="${provider.id}">移除</button></div>`).join("");
  box.querySelectorAll(".provider-model").forEach((input) => input.onchange = async () => {
    providers = providers.map((provider) => provider.id === input.dataset.provider ? { ...provider, model: input.value.trim() || provider.model } : provider);
    await saveProviders(providers);
    toast("模型名称已更新");
  });
  box.querySelectorAll(".remove-provider").forEach((button) => button.onclick = async () => {
    await removeProviderSecret(button.dataset.provider);
    providers = providers.filter((provider) => provider.id !== button.dataset.provider);
    await saveProviders(providers);
    renderProviders();
    renderConnectionSummary();
    toast("已移除模型连接");
  });
}

function renderConnectionSummary() {
  const openAI = providers.some((provider) => provider.id === "openai");
  $("connectionSummary").textContent = openAI ? `GPT-5.5 已连接${providers.length > 1 ? ` · ${providers.length - 1} 个辅助模型` : ""}` : "等待添加 OpenAI Key";
}

async function getOrCreateConversation(firstText) {
  if (activeConversationId) {
    const existing = await getConversation(activeConversationId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const conversation = {
    id: crypto.randomUUID(),
    title: firstText.replace(/\s+/g, " ").slice(0, 32),
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  activeConversationId = conversation.id;
  return conversation;
}

function createMessage(role, content) {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString() };
}

async function loadConversationList() {
  const items = await listConversations();
  const box = $("conversationList");
  box.innerHTML = items.length
    ? items.map((item) => `<button class="conversation-item${item.id === activeConversationId ? " active" : ""}" data-id="${item.id}">${escapeHtml(item.title || "新对话")}</button>`).join("")
    : `<small>还没有对话</small>`;
  box.querySelectorAll(".conversation-item").forEach((button) => button.onclick = () => openConversation(button.dataset.id));
}

async function openConversation(id) {
  const conversation = await getConversation(id);
  if (!conversation) return;
  activeConversationId = id;
  $("conversationTitle").textContent = conversation.title;
  $("messages").replaceChildren();
  conversation.messages.forEach((message) => appendMessage(message));
  showPage("chat");
  await loadConversationList();
}

function newChat() {
  activeConversationId = null;
  $("conversationTitle").textContent = "新对话";
  setStatus("GPT-5.5 将直接与你对话");
  $("messages").innerHTML = `<div id="welcome" class="welcome"><div class="welcome-mark">M</div><h2>想聊什么，直接说</h2><p>GPT-5.5 固定负责最终回答；Gemini、DeepSeek 可在后台补充意见。</p><div class="suggestions"><button>帮我判断这个项目下一步怎么做</button><button>把我的想法整理成可执行计划</button><button>帮我检查一个决策有没有漏洞</button></div></div>`;
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  showPage("chat");
  loadConversationList();
}

function appendMessage(message, consulted = [], usage = 0) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  const meta = message.role === "assistant" && (consulted.length || usage)
    ? `<div class="message-meta">${consulted.length ? `后台参考：${escapeHtml(consulted.join("、"))}` : ""}${consulted.length && usage ? " · " : ""}${usage ? `${usage} tokens` : ""}</div>`
    : "";
  node.innerHTML = `<div class="avatar">${message.role === "user" ? "你" : "M"}</div><div><div class="bubble">${escapeHtml(message.content)}</div>${meta}</div>`;
  $("messages").append(node);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}

function appendThinking() { return appendMessage(createMessage("assistant", "正在思考…")); }
function setStatus(text) { $("chatStatus").textContent = text; }
function showDetectMessage(text, error = false) { const box = $("detectMessage"); box.textContent = text; box.className = `inline-message${error ? " error" : ""}`; box.classList.remove("hidden"); }
function resizeInput() { const input = $("chatInput"); input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
function clampInteger(value, min, max, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function readError(error) { return error?.message || String(error); }
function toast(text, error = false) { const box = $("toast"); box.textContent = text; box.className = `toast${error ? " error" : ""}`; box.classList.remove("hidden"); setTimeout(() => box.classList.add("hidden"), 3200); }
