import {
  getConversation,
  initializeStorage,
  loadAgentProfiles,
  loadPreferences,
  loadProjectMemory,
  loadProviders,
  removeRecord,
  saveConversation,
  saveProjectMemory
} from "./storage.js";
import {
  estimateCallCount,
  getRecipe,
  modeLabel,
  normalizeRecipe,
  routeTask,
  selectParticipants
} from "./orchestrator.js";

let routeTimer = null;
let routeRequestId = 0;
let mutationTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  bindWorkspaceControls();
  bindRoutePreview();
  observeDynamicUi();
  refreshWorkspaceUi();
  scheduleRoutePreview();
});

function bindWorkspaceControls() {
  const search = document.getElementById("conversationSearch");
  const rename = document.getElementById("renameConversationButton");
  const remove = document.getElementById("deleteConversationButton");

  search?.addEventListener("input", applyConversationFilter);
  rename?.addEventListener("click", renameActiveConversation);
  remove?.addEventListener("click", deleteActiveConversation);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      search?.focus();
      search?.select();
    }
    if (event.key === "Escape" && document.activeElement === search && search?.value) {
      search.value = "";
      applyConversationFilter();
    }
  });
}

function bindRoutePreview() {
  const input = document.getElementById("chatInput");
  const recipe = document.getElementById("recipePicker");
  const mode = document.getElementById("runMode");
  const maxAgents = document.getElementById("maxDebateAgents");
  const rounds = document.getElementById("debateRounds");

  input?.addEventListener("input", scheduleRoutePreview);
  recipe?.addEventListener("change", scheduleRoutePreview);
  mode?.addEventListener("change", scheduleRoutePreview);
  maxAgents?.addEventListener("input", scheduleRoutePreview);
  rounds?.addEventListener("change", scheduleRoutePreview);
}

function observeDynamicUi() {
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      refreshWorkspaceUi();
      scheduleRoutePreview();
    }, 30);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function refreshWorkspaceUi() {
  applyConversationFilter();
  syncConversationControls();
  decorateResultActions();
  decorateCodeBlocks();
}

function applyConversationFilter() {
  const search = document.getElementById("conversationSearch");
  const query = String(search?.value || "").trim().toLowerCase();
  const items = Array.from(document.querySelectorAll(".conversation-item"));
  let visible = 0;

  items.forEach((item) => {
    const matched = !query || item.textContent.toLowerCase().includes(query);
    item.hidden = !matched;
    if (matched) visible += 1;
  });

  const count = document.getElementById("conversationCount");
  if (count) count.textContent = query ? `${visible}/${items.length}` : String(items.length);
}

function syncConversationControls() {
  const active = getActiveConversationButton();
  const running = !document.getElementById("stopButton")?.classList.contains("hidden");
  const rename = document.getElementById("renameConversationButton");
  const remove = document.getElementById("deleteConversationButton");
  if (rename) rename.disabled = !active;
  if (remove) remove.disabled = !active || running;
}

async function renameActiveConversation() {
  const active = getActiveConversationButton();
  if (!active) return showToast("先打开一个已有对话。", true);

  const conversation = await getConversation(active.dataset.id);
  if (!conversation) return showToast("没有找到这个对话。", true);

  const nextTitle = window.prompt("重命名对话", conversation.title || "新对话");
  if (nextTitle === null) return;
  const normalized = nextTitle.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!normalized) return showToast("对话名称不能为空。", true);

  conversation.title = normalized;
  await saveConversation(conversation);
  active.textContent = normalized;
  const heading = document.getElementById("conversationTitle");
  if (heading) heading.textContent = normalized;
  applyConversationFilter();
  showToast("对话已重命名");
}

async function deleteActiveConversation() {
  const active = getActiveConversationButton();
  if (!active) return showToast("先打开一个已有对话。", true);
  if (!document.getElementById("stopButton")?.classList.contains("hidden")) {
    return showToast("当前任务仍在运行，请先停止。", true);
  }

  const title = active.textContent.trim() || "这个对话";
  if (!window.confirm(`删除“${title}”？删除后无法恢复。`)) return;

  await removeRecord("conversations", active.dataset.id);
  document.getElementById("newChatButton")?.click();
  setTimeout(refreshWorkspaceUi, 80);
  showToast("对话已删除");
}

function getActiveConversationButton() {
  return document.querySelector(".conversation-item.active");
}

function scheduleRoutePreview() {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(refreshRoutePreview, 160);
}

async function refreshRoutePreview() {
  const hint = document.getElementById("routeHint");
  const input = document.getElementById("chatInput");
  const recipePicker = document.getElementById("recipePicker");
  if (!hint || !input || !recipePicker) return;

  const text = input.value.trim();
  if (!text) {
    hint.textContent = recipePicker.value === "auto"
      ? "输入内容后显示预计流程"
      : `${getRecipe(normalizeRecipe(recipePicker.value)).label} · 等待输入`;
    hint.removeAttribute("title");
    hint.classList.remove("route-preview-ready");
    return;
  }

  const requestId = ++routeRequestId;
  try {
    const [preferences, providers, agentProfiles, projectMemory] = await Promise.all([
      loadPreferences(),
      loadProviders(),
      loadAgentProfiles(),
      loadProjectMemory()
    ]);
    if (requestId !== routeRequestId) return;

    if (!providers.length) {
      hint.textContent = "先接入一个模型";
      hint.classList.add("route-preview-ready");
      return;
    }

    const requestedRecipe = normalizeRecipe(recipePicker.value);
    const plan = routeTask({
      text,
      requestedMode: preferences.runMode,
      requestedRecipe,
      availableAgents: providers.length
    });
    const primary = providers.find((provider) => provider.id === preferences.primaryProviderId) || providers[0];
    const selected = selectParticipants({
      providers,
      primaryId: primary?.id,
      agentProfiles,
      maxAgents: preferences.maxDebateAgents,
      recipe: plan.recipe
    });
    const participants = plan.mode === "quick" ? [primary].filter(Boolean) : selected;
    const calls = estimateCallCount({
      mode: plan.mode,
      participantCount: participants.length,
      rounds: preferences.debateRounds
    });
    const names = participants
      .map((provider) => agentProfiles[provider.id]?.displayName || provider.label || provider.id)
      .join(" + ");
    const memoryFlag = projectMemory.name ? " · 已带项目记忆" : "";

    hint.textContent = `预计：${getRecipe(plan.recipe).label} · ${modeLabel(plan.mode)} · ${calls} 次调用${names ? ` · ${names}` : ""}${memoryFlag}`;
    hint.title = plan.reason;
    hint.classList.add("route-preview-ready");
  } catch {
    hint.textContent = "自动路由预览暂不可用，发送时仍会正常判断";
  }
}

function decorateResultActions() {
  document.querySelectorAll(".message.assistant .result-actions").forEach((actions) => {
    if (actions.querySelector('[data-ux-action="save-decision"]')) return;
    const row = actions.querySelector(".action-row");
    if (!row) return;

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.uxAction = "save-decision";
    button.textContent = "保存为决定";
    button.addEventListener("click", () => saveMessageAsDecision(actions.closest(".message"), button));
    row.append(button);
  });
}

async function saveMessageAsDecision(messageNode, button) {
  const content = messageNode?.querySelector(".bubble")?.innerText?.trim();
  if (!content) return showToast("没有可保存的结论。", true);

  const memory = await loadProjectMemory();
  const decision = extractDecision(content);
  const title = document.getElementById("conversationTitle")?.textContent?.trim() || "未命名对话";
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const entry = `[${date}] ${title}\n${decision}`;

  if (String(memory.decisions || "").includes(decision)) {
    button.textContent = "已保存";
    return showToast("这个结论已经在项目决定里。", true);
  }

  memory.decisions = [String(memory.decisions || "").trim(), entry].filter(Boolean).join("\n\n");
  await saveProjectMemory(memory);

  const field = document.getElementById("projectDecisions");
  if (field) field.value = memory.decisions;
  const summary = document.getElementById("projectSummary");
  if (summary && memory.name) summary.textContent = `项目：${memory.name}`;
  button.textContent = "已保存";
  button.disabled = true;
  showToast("已加入项目的“已确认决定”");
}

function extractDecision(content) {
  const normalized = String(content).replace(/\r/g, "").trim();
  const match = normalized.match(/(?:^|\n)(?:结论|总体判断|推荐方案|核心创意)\s*[：:]?\s*\n?([\s\S]*?)(?=\n(?:关键原因|下一步|代价|风险|仍有争议|执行步骤|验收标准|候选方向)\s*[：:]?|$)/);
  const selected = (match?.[1] || normalized)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return selected.length > 1200 ? `${selected.slice(0, 1200)}…` : selected;
}

function decorateCodeBlocks() {
  document.querySelectorAll("pre.code-block").forEach((block) => {
    if (block.parentElement?.classList.contains("code-shell")) return;

    const shell = document.createElement("div");
    shell.className = "code-shell";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.textContent = "复制代码";
    button.addEventListener("click", async () => {
      const code = block.querySelector("code")?.textContent || block.textContent || "";
      await copyText(code);
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = "复制代码"; }, 1400);
    });

    block.before(shell);
    shell.append(button, block);
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function showToast(text, error = false) {
  const box = document.getElementById("toast");
  if (!box) return;
  box.textContent = text;
  box.className = `toast${error ? " error" : ""}`;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 2800);
}
