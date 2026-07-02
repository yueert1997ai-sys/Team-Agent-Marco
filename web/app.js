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
  PROVIDER_DEFAULTS,
  consultProvider,
  detectProvider,
  generatePrimary
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
  providers = normalizeProviders(await loadProviders());
  if (providers.some((provider) => provider.id === "deepseek") && !providers.some((provider) => provider.id === preferences.primaryProviderId)) {
    preferences.primaryProviderId = "deepseek";
    await savePreferences(preferences);
  }
  bindEvents();
  renderSettings();
  renderPrimaryState();
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
  $("toggleKeyButton").onclick = toggleKeyVisibility;
  $("providerHint").onchange = toggleCustomFields;
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
  const primary = getPrimaryProvider();
  if (!primary) {
    showPage("settings");
    toast("请先连接一个模型。DeepSeek 会优先成为总控。", true);
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
  setStatus(`${primary.label} 正在理解你的问题`);
  const thinking = appendThinking(primary.label);

  try {
    const internalNotes = [];
    const consulted = [];
    if (preferences.consultExperts) {
      const experts = providers.filter((provider) => provider.id !== primary.id);
      if (experts.length) {
        setStatus("辅助模型正在后台补充意见");
        const results = await Promise.all(experts.map((provider) =>
          consultProvider(provider, conversation.messages, preferences.timeoutMs).catch(() => null)
        ));
        results.forEach((result, index) => {
          if (!result?.text) return;
          internalNotes.push(`${experts[index].label}：${result.text}`);
          consulted.push(experts[index].label);
        });
      }
    }

    setStatus(`${primary.label} 正在组织最终回复`);
    const final = await generatePrimary({ provider: primary, messages: conversation.messages, internalNotes, preferences });
    const assistantMessage = createMessage("assistant", final.text);
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = assistantMessage.createdAt;
    await saveConversation(conversation);
    thinking.remove();
    appendMessage(assistantMessage, consulted, final.usage);
    $("conversationTitle").textContent = conversation.title;
    setStatus(consulted.length ? `${primary.label} 已参考 ${consulted.join("、")}` : `${primary.label} 已回答`);
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
  const hint = $("providerHint").value;
  const custom = {
    label: $("customLabel").value,
    baseUrl: $("customBaseUrl").value,
    model: $("customModel").value
  };
  const button = $("detectKeyButton");
  button.disabled = true;
  button.textContent = "连接中…";
  try {
    const detected = await detectProvider(key, preferences.timeoutMs, hint, custom);
    await saveProviderSecret(detected.id, key, $("rememberKey").checked);
    providers = [...providers.filter((provider) => provider.id !== detected.id), detected];
    if (detected.id === "deepseek" || !getPrimaryProvider()) {
      preferences.primaryProviderId = detected.id;
      await savePreferences(preferences);
    }
    await saveProviders(providers);
    $("universalApiKey").value = "";
    showDetectMessage(`已连接 ${detected.label} · ${detected.model}`);
    renderProviders();
    renderPrimaryState();
    toast(`${detected.label} 已连接`);
  } catch (error) {
    showDetectMessage(readError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "连接";
  }
}

async function persistPreferences() {
  preferences = {
    ...preferences,
    consultExperts: $("consultExperts").checked,
    maxOutputTokens: clampInteger($("maxOutputTokens").value, 100, 128000, 4000),
    timeoutMs: clampInteger($("timeoutMs").value, 5000, 600000, 120000)
  };
  await savePreferences(preferences);
  toast("已保存");
}

function renderSettings() {
  $("consultExperts").checked = preferences.consultExperts;
  $("maxOutputTokens").value = preferences.maxOutputTokens;
  $("timeoutMs").value = preferences.timeoutMs;
  toggleCustomFields();
  renderProviders();
  renderPrimaryState();
}

function renderProviders() {
  const box = $("providerList");
  if (!providers.length) {
    box.innerHTML = `<div class="inline-message">还没有连接模型。你可以先添加 DeepSeek 或智谱 GLM。</div>`;
    return;
  }
  box.innerHTML = providers.map((provider) => {
    const isPrimary = provider.id === preferences.primaryProviderId;
    return `<div class="provider-row">
      <div class="provider-title"><strong>${escapeHtml(provider.label)}${isPrimary ? '<span class="primary-tag">总控</span>' : ""}</strong><small>${escapeHtml(provider.baseUrl)}</small></div>
      <input class="provider-model" data-provider="${escapeHtml(provider.id)}" value="${escapeHtml(provider.model)}" aria-label="模型名称">
      ${isPrimary ? '<span></span>' : `<button class="set-primary" data-provider="${escapeHtml(provider.id)}">设为总控</button>`}
      <button class="danger remove-provider" data-provider="${escapeHtml(provider.id)}">移除</button>
    </div>`;
  }).join("");

  box.querySelectorAll(".provider-model").forEach((input) => input.onchange = async () => {
    providers = providers.map((provider) => provider.id === input.dataset.provider
      ? { ...provider, model: input.value.trim() || provider.model }
      : provider
    );
    await saveProviders(providers);
    renderPrimaryState();
    toast("模型名已更新");
  });
  box.querySelectorAll(".set-primary").forEach((button) => button.onclick = async () => {
    preferences.primaryProviderId = button.dataset.provider;
    await savePreferences(preferences);
    renderProviders();
    renderPrimaryState();
    toast("总控已切换");
  });
  box.querySelectorAll(".remove-provider").forEach((button) => button.onclick = async () => {
    const removedId = button.dataset.provider;
    await removeProviderSecret(removedId);
    providers = providers.filter((provider) => provider.id !== removedId);
    if (preferences.primaryProviderId === removedId) {
      preferences.primaryProviderId = providers.find((provider) => provider.id === "deepseek")?.id || providers[0]?.id || "deepseek";
      await savePreferences(preferences);
    }
    await saveProviders(providers);
    renderProviders();
    renderPrimaryState();
    toast("已移除模型");
  });
}

function renderPrimaryState() {
  const primary = getPrimaryProvider();
  const label = primary ? `${primary.label} · ${primary.model}` : "未连接";
  $("primaryModelBadge").textContent = primary?.label || "未连接";
  $("connectionSummary").textContent = primary ? `总控：${label}` : "等待添加模型";
  $("chatStatus").textContent = primary ? `${primary.label} 将作为当前总控` : "请先在设置中添加模型";
  const subtitle = $("welcomeSubtitle");
  if (subtitle) subtitle.textContent = primary
    ? `${primary.label} 负责最终回答，其他模型可在后台提供参考。`
    : "添加 DeepSeek、智谱 GLM 或其他模型后即可开始。";
}

function getPrimaryProvider() {
  return providers.find((provider) => provider.id === preferences?.primaryProviderId)
    || providers.find((provider) => provider.id === "deepseek")
    || providers[0]
    || null;
}

function normalizeProviders(items) {
  return items.map((provider) => {
    const defaults = PROVIDER_DEFAULTS[provider.id];
    return defaults ? { ...defaults, ...provider } : { protocol: "openai-chat", ...provider };
  });
}

function toggleCustomFields() {
  const visible = $("providerHint").value === "custom";
  document.querySelectorAll(".custom-field").forEach((field) => field.classList.toggle("hidden", !visible));
}

function toggleKeyVisibility() {
  const input = $("universalApiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("toggleKeyButton").textContent = input.type === "password" ? "显示 Key" : "隐藏 Key";
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
  const primary = getPrimaryProvider();
  $("messages").innerHTML = `<div id="welcome" class="welcome"><h2>有什么可以帮你？</h2><p id="welcomeSubtitle">${primary ? `${escapeHtml(primary.label)} 负责最终回答，其他模型可在后台提供参考。` : "添加模型后即可开始。"}</p><div class="suggestions"><button>帮我判断这个项目下一步怎么做</button><button>把我的想法整理成可执行计划</button><button>帮我检查一个决策有没有漏洞</button></div></div>`;
  document.querySelectorAll(".suggestions button").forEach((button) => button.onclick = () => fillSuggestion(button.textContent));
  renderPrimaryState();
  showPage("chat");
  loadConversationList();
}

function appendMessage(message, consulted = [], usage = 0) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  const meta = message.role === "assistant" && (consulted.length || usage)
    ? `<div class="message-meta">${consulted.length ? `参考：${escapeHtml(consulted.join("、"))}` : ""}${consulted.length && usage ? " · " : ""}${usage ? `${usage} tokens` : ""}</div>`
    : "";
  node.innerHTML = `<div class="message-body"><div class="bubble">${escapeHtml(message.content)}</div>${meta}</div>`;
  $("messages").append(node);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}

function appendThinking(label) { return appendMessage(createMessage("assistant", `${label} 正在思考…`)); }
function setStatus(text) { $("chatStatus").textContent = text; }
function showDetectMessage(text, error = false) { const box = $("detectMessage"); box.textContent = text; box.className = `inline-message${error ? " error" : ""}`; box.classList.remove("hidden"); }
function resizeInput() { const input = $("chatInput"); input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; }
function clampInteger(value, min, max, fallback) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function readError(error) { return error?.message || String(error); }
function toast(text, error = false) { const box = $("toast"); box.textContent = text; box.className = `toast${error ? " error" : ""}`; box.classList.remove("hidden"); setTimeout(() => box.classList.add("hidden"), 3200); }
