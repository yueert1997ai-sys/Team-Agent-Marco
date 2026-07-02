const api = window.teamAgent;
let settings = null;
let activeConversationId = null;
let sending = false;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  api.onChatEvent(handleChatEvent);
  await Promise.all([loadSettings(), loadConversationList()]);
  resizeInput();
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
  document.querySelectorAll(".suggestions button").forEach((button) => {
    button.onclick = () => {
      $("chatInput").value = button.textContent;
      resizeInput();
      $("chatInput").focus();
    };
  });
  $("toggleUniversalKey").onclick = () => {
    const input = $("universalApiKey");
    input.type = input.type === "password" ? "text" : "password";
    $("toggleUniversalKey").textContent = input.type === "password" ? "显示" : "隐藏";
  };
  $("detectKeyButton").onclick = detectAndSaveKey;
  $("saveRuntimeButton").onclick = saveRuntime;
  $("chooseDirectoryButton").onclick = chooseDirectory;
}

function showPage(page) {
  $("chatPage").classList.toggle("active", page === "chat");
  $("settingsPage").classList.toggle("active", page === "settings");
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text || sending) return;
  if (!hasProvider("openai")) {
    showPage("settings");
    toast("请先添加 OpenAI API Key，GPT-5.5 才能作为总控回答。", true);
    return;
  }
  sending = true;
  $("sendButton").disabled = true;
  $("welcome").classList.add("hidden");
  appendMessage({ role: "user", content: text, createdAt: new Date().toISOString() });
  $("chatInput").value = "";
  resizeInput();
  setStatus("GPT-5.5 正在思考");
  const placeholder = appendThinking();
  try {
    const result = await api.sendChat({ conversationId: activeConversationId || undefined, message: text });
    activeConversationId = result.conversation.id;
    placeholder.remove();
    appendMessage(result.assistantMessage, result.consultedProviders, result.usageTokens);
    $("conversationTitle").textContent = result.conversation.title;
    setStatus(result.consultedProviders.length ? `GPT-5.5 已参考 ${result.consultedProviders.join("、")}` : "GPT-5.5 已回答");
    await loadConversationList();
  } catch (error) {
    placeholder.remove();
    appendMessage({ role: "assistant", content: `运行失败：${readError(error)}`, createdAt: new Date().toISOString() });
    setStatus("发送失败");
  } finally {
    sending = false;
    $("sendButton").disabled = false;
    $("chatInput").focus();
  }
}

function appendMessage(message, providers = [], tokens = 0) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  const meta = message.role === "assistant" && (providers.length || tokens)
    ? `<div class="message-meta">${providers.length ? `后台参考：${esc(providers.join("、"))}` : ""}${providers.length && tokens ? " · " : ""}${tokens ? `${tokens} tokens` : ""}</div>`
    : "";
  node.innerHTML = `<div class="avatar">${message.role === "user" ? "你" : "M"}</div><div><div class="bubble">${esc(message.content)}</div>${meta}</div>`;
  $("messages").append(node);
  $("messages").scrollTop = $("messages").scrollHeight;
  return node;
}

function appendThinking() {
  return appendMessage({ role: "assistant", content: "正在思考…", createdAt: new Date().toISOString() });
}

function handleChatEvent(event) {
  if (event.type === "status") setStatus(event.text);
  if (event.type === "provider_completed") setStatus(`${event.provider} 已完成后台分析，GPT-5.5 正在整合`);
}

function setStatus(text) {
  $("chatStatus").textContent = text;
}

function newChat() {
  activeConversationId = null;
  $("conversationTitle").textContent = "新对话";
  $("chatStatus").textContent = "GPT-5.5 将直接与你对话";
  $("messages").innerHTML = `<div id="welcome" class="welcome"><div class="welcome-mark">M</div><h2>想聊什么，直接说</h2><p>GPT-5.5 固定负责最终回答。配置 Gemini 或 DeepSeek 后，它们只在后台提供辅助意见。</p><div class="suggestions"><button>帮我判断这个项目下一步怎么做</button><button>把我的想法整理成可执行计划</button><button>帮我检查一个决策有没有漏洞</button></div></div>`;
  document.querySelectorAll(".suggestions button").forEach((button) => {
    button.onclick = () => { $("chatInput").value = button.textContent; resizeInput(); $("chatInput").focus(); };
  });
  document.querySelectorAll(".conversation-item").forEach((item) => item.classList.remove("active"));
  showPage("chat");
}

async function loadConversationList() {
  const items = await api.listConversations();
  const box = $("conversationList");
  box.innerHTML = items.length
    ? items.map((item) => `<button class="conversation-item${item.id === activeConversationId ? " active" : ""}" data-id="${esc(item.id)}" title="${esc(item.preview)}">${esc(item.title)}</button>`).join("")
    : `<small>还没有对话</small>`;
  box.querySelectorAll(".conversation-item").forEach((button) => button.onclick = () => openConversation(button.dataset.id));
}

async function openConversation(id) {
  const conversation = await api.getConversation(id);
  if (!conversation) return toast("对话记录不存在", true);
  activeConversationId = conversation.id;
  $("conversationTitle").textContent = conversation.title;
  $("messages").replaceChildren();
  conversation.messages.forEach((message) => appendMessage(message));
  showPage("chat");
  await loadConversationList();
}

async function loadSettings() {
  settings = await api.getSettings();
  $("consultExperts").checked = settings.consultExperts;
  $("maxOutputTokens").value = settings.maxOutputTokens;
  $("timeoutMs").value = settings.timeoutMs;
  $("maxRetries").value = settings.maxRetries;
  $("retryBaseDelayMs").value = settings.retryBaseDelayMs;
  $("conversationDirectory").value = settings.conversationDirectory;
  $("secureStorageBadge").textContent = settings.encryptionAvailable ? "本机加密可用" : "本机加密不可用";
  renderProviders();
  renderConnectionSummary();
}

async function detectAndSaveKey() {
  const key = $("universalApiKey").value.trim();
  if (!key) return detectMessage("请先粘贴 API Key。", true);
  const button = $("detectKeyButton");
  button.disabled = true;
  button.textContent = "正在识别…";
  try {
    const result = await api.detectAndSaveApiKey(key);
    settings = result.settings;
    $("universalApiKey").value = "";
    detectMessage(`已识别为 ${result.detected.label}，并安全保存。`);
    renderProviders();
    renderConnectionSummary();
    toast(`${result.detected.label} 已连接`);
  } catch (error) {
    detectMessage(readError(error), true);
  } finally {
    button.disabled = false;
    button.textContent = "识别并保存";
  }
}

function renderProviders() {
  const box = $("providerList");
  const connected = settings.providers.filter((provider) => provider.apiKeyConfigured);
  if (!connected.length) {
    box.innerHTML = `<div class="inline-message error">还没有连接模型。请先添加 OpenAI Key，GPT-5.5 才能回复。</div>`;
    return;
  }
  box.innerHTML = connected.map((provider) => `<div class="provider-row"><div class="provider-title"><div class="provider-icon">${provider.id === "openai" ? "O" : provider.id === "gemini" ? "G" : "D"}</div><div><strong>${esc(provider.label)}${provider.primary ? " · 总控" : " · 辅助"}</strong><small>${provider.primary ? "固定使用 GPT-5.5 负责最终回答" : "只在后台提供参考"}</small></div></div>${provider.primary ? `<div class="fixed-model">GPT-5.5</div>` : `<input class="provider-model" data-provider="${provider.id}" value="${esc(provider.model)}" aria-label="模型">`}<button class="danger remove-provider" data-provider="${provider.id}">移除</button></div>`).join("");
  box.querySelectorAll(".provider-model").forEach((input) => input.onchange = async () => {
    settings = await api.updateProvider({ provider: input.dataset.provider, model: input.value });
    toast("模型名称已更新");
  });
  box.querySelectorAll(".remove-provider").forEach((button) => button.onclick = async () => {
    settings = await api.removeProvider(button.dataset.provider);
    renderProviders();
    renderConnectionSummary();
    toast("已移除模型连接");
  });
}

async function saveRuntime() {
  try {
    settings = await api.updateRuntime({
      consultExperts: $("consultExperts").checked,
      maxOutputTokens: Number($("maxOutputTokens").value),
      timeoutMs: Number($("timeoutMs").value),
      maxRetries: Number($("maxRetries").value),
      retryBaseDelayMs: Number($("retryBaseDelayMs").value),
      conversationDirectory: $("conversationDirectory").value
    });
    toast("运行偏好已保存");
  } catch (error) {
    toast(readError(error), true);
  }
}

async function chooseDirectory() {
  const directory = await api.chooseConversationDirectory();
  if (directory) $("conversationDirectory").value = directory;
}

function renderConnectionSummary() {
  const connected = settings.providers.filter((provider) => provider.apiKeyConfigured);
  const openAI = hasProvider("openai");
  $("connectionSummary").textContent = openAI
    ? `GPT-5.5 已连接${connected.length > 1 ? ` · ${connected.length - 1} 个辅助模型` : ""}`
    : "等待添加 OpenAI Key";
}

function hasProvider(id) {
  return Boolean(settings?.providers.find((provider) => provider.id === id)?.apiKeyConfigured);
}

function detectMessage(text, error = false) {
  const box = $("detectMessage");
  box.textContent = text;
  box.className = `inline-message${error ? " error" : ""}`;
  box.classList.remove("hidden");
}

function resizeInput() {
  const input = $("chatInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

function toast(text, error = false) {
  const box = $("toast");
  box.textContent = text;
  box.className = `toast${error ? " error" : ""}`;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 3200);
}

function readError(error) {
  return error?.message || String(error);
}
