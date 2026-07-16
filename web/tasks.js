import {
  getRecord,
  initializeStorage,
  putRecord
} from "./storage.js";

const RECORD_ID = "task-desk";
const ACTIVE_TASK_KEY = "marco-active-task";
const PRIORITY_ORDER = ["high", "normal", "low"];
let tasks = [];
let activeFilter = "today";
let taskObserverTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  await initializeStorage();
  tasks = (await loadTasks()).map(migrateTask);
  await persistTasks();
  ensureTaskControls();
  bindTaskDesk();
  observeResults();
  renderTasks();
  decorateTaskActions();
  decorateWelcome();
  restoreInterruptedTask();
});

function ensureTaskControls() {
  const capture = document.querySelector(".task-capture");
  const actions = document.querySelector(".task-capture-actions");
  if (capture && actions && !document.getElementById("taskPriority")) {
    const controls = document.createElement("div");
    controls.className = "task-meta-controls";
    controls.innerHTML = `<label>优先级
      <select id="taskPriority">
        <option value="normal">普通</option>
        <option value="high">高优先</option>
        <option value="low">低优先</option>
      </select>
    </label>
    <label>安排
      <select id="taskSchedule">
        <option value="today">今天</option>
        <option value="later">以后</option>
      </select>
    </label>`;
    capture.insertBefore(controls, actions);
  }

  const filters = document.querySelector(".task-filters");
  if (filters && !filters.querySelector('[data-task-filter="today"]')) {
    filters.querySelectorAll(".task-filter").forEach((button) => button.classList.remove("active"));
    const today = document.createElement("button");
    today.type = "button";
    today.className = "task-filter active";
    today.dataset.taskFilter = "today";
    today.innerHTML = `今天 <span id="todayTaskCount">0</span>`;
    filters.prepend(today);
  }

  const subtitle = document.querySelector(".task-desk-head small");
  if (subtitle) subtitle.textContent = "今天要做什么，做完结果在哪，都放这里";
}

function bindTaskDesk() {
  const open = document.getElementById("openTasksButton");
  const close = document.getElementById("closeTasksButton");
  const backdrop = document.getElementById("taskDeskBackdrop");
  const input = document.getElementById("taskInput");

  open?.addEventListener("click", openTaskDesk);
  close?.addEventListener("click", closeTaskDesk);
  backdrop?.addEventListener("click", closeTaskDesk);
  document.getElementById("saveTaskButton")?.addEventListener("click", () => captureTask("inbox"));
  document.getElementById("runTaskButton")?.addEventListener("click", () => captureTask("task", true));
  document.getElementById("delegateTaskButton")?.addEventListener("click", () => captureTask("delegate", true));
  document.getElementById("taskList")?.addEventListener("click", handleTaskAction);

  document.querySelectorAll(".task-filter").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.taskFilter || "today";
      document.querySelectorAll(".task-filter").forEach((item) => item.classList.toggle("active", item === button));
      renderTasks();
    });
  });

  input?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      captureTask("inbox");
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      captureTask("delegate", true);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("taskDesk")?.classList.contains("hidden")) closeTaskDesk();
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openTaskDesk();
    }
  });
}

function openTaskDesk() {
  document.getElementById("taskDesk")?.classList.remove("hidden");
  document.getElementById("taskDeskBackdrop")?.classList.remove("hidden");
  document.body.classList.add("task-desk-open");
  setTimeout(() => document.getElementById("taskInput")?.focus(), 40);
}

function closeTaskDesk() {
  document.getElementById("taskDesk")?.classList.add("hidden");
  document.getElementById("taskDeskBackdrop")?.classList.add("hidden");
  document.body.classList.remove("task-desk-open");
}

async function captureTask(mode, execute = false) {
  const input = document.getElementById("taskInput");
  const title = String(input?.value || "").trim();
  if (!title) return showToast("先写下要处理的事。", true);

  const task = createTask(title, mode === "delegate" ? "delegate" : "task", {
    priority: document.getElementById("taskPriority")?.value,
    schedule: document.getElementById("taskSchedule")?.value
  });
  tasks.unshift(task);
  await persistTasks();
  if (input) input.value = "";
  renderTasks();

  if (execute) {
    await executeTask(task.id, mode);
  } else {
    showToast(task.schedule === "today" ? "已加入今天" : "已放到以后");
  }
}

function createTask(title, preferredRecipe = "task", options = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: String(title).trim().slice(0, 1600),
    status: "inbox",
    preferredRecipe: preferredRecipe === "delegate" ? "delegate" : "task",
    priority: normalizePriority(options.priority),
    schedule: normalizeSchedule(options.schedule),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    lastRunAt: null,
    conversationId: null,
    runId: null,
    resultSummary: "",
    lastError: ""
  };
}

function migrateTask(task = {}) {
  const createdAt = task.createdAt || new Date().toISOString();
  return {
    ...task,
    id: task.id || crypto.randomUUID(),
    title: String(task.title || "未命名任务").slice(0, 1600),
    status: ["inbox", "running", "done"].includes(task.status) ? task.status : "inbox",
    preferredRecipe: task.preferredRecipe === "delegate" ? "delegate" : "task",
    priority: normalizePriority(task.priority),
    schedule: normalizeSchedule(task.schedule),
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    completedAt: task.completedAt || null,
    lastRunAt: task.lastRunAt || null,
    conversationId: task.conversationId || null,
    runId: task.runId || null,
    resultSummary: String(task.resultSummary || ""),
    lastError: String(task.lastError || "")
  };
}

async function handleTaskAction(event) {
  const button = event.target.closest("button[data-task-action]");
  if (!button) return;
  const item = button.closest(".task-item");
  const taskId = item?.dataset.taskId;
  const action = button.dataset.taskAction;
  if (!taskId) return;

  if (action === "run") return executeTask(taskId, "task");
  if (action === "delegate") return executeTask(taskId, "delegate");
  if (action === "toggle") return toggleTask(taskId);
  if (action === "delete") return deleteTask(taskId);
  if (action === "edit") return editTask(taskId);
  if (action === "priority") return cyclePriority(taskId);
  if (action === "schedule") return toggleSchedule(taskId);
  if (action === "view") return openTaskResult(taskId);
}

async function executeTask(taskId, recipe) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;

  const recipePicker = document.getElementById("recipePicker");
  const chatInput = document.getElementById("chatInput");
  const chatForm = document.getElementById("chatForm");
  const sendButton = document.getElementById("sendButton");
  if (!recipePicker || !chatInput || !chatForm || sendButton?.disabled) {
    return showToast("当前任务正在运行，请稍后再试。", true);
  }

  const now = new Date().toISOString();
  task.status = "running";
  task.preferredRecipe = recipe === "delegate" ? "delegate" : "task";
  task.lastRunAt = now;
  task.updatedAt = now;
  task.completedAt = null;
  task.lastError = "";
  await persistTasks();
  renderTasks();

  writeActiveTaskMarker({
    id: task.id,
    baselineResults: 0,
    startedAt: task.lastRunAt,
    attempts: 0
  });
  closeTaskDesk();
  document.getElementById("newChatButton")?.click();

  recipePicker.value = task.preferredRecipe;
  chatInput.value = task.preferredRecipe === "delegate"
    ? `请把下面任务分工给合适的 Agent 并行处理。每个 Agent 领取清晰子任务并交付结果，最后由总控汇总：\n\n${task.title}`
    : `直接完成下面这件小事，给我可以直接使用的结果：\n\n${task.title}`;
  chatInput.dispatchEvent(new Event("input", { bubbles: true }));
  recipePicker.dispatchEvent(new Event("change", { bubbles: true }));
  setTimeout(() => chatForm.requestSubmit(), 80);
}

async function editTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.status === "running") return;
  const next = window.prompt("编辑任务", task.title);
  if (next === null) return;
  const title = next.trim().slice(0, 1600);
  if (!title) return showToast("任务内容不能为空。", true);
  task.title = title;
  task.updatedAt = new Date().toISOString();
  await persistTasks();
  renderTasks();
  showToast("任务已更新");
}

async function cyclePriority(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.status === "running") return;
  const index = PRIORITY_ORDER.indexOf(task.priority);
  task.priority = PRIORITY_ORDER[(index + 1) % PRIORITY_ORDER.length];
  task.updatedAt = new Date().toISOString();
  await persistTasks();
  renderTasks();
}

async function toggleSchedule(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.status === "running") return;
  task.schedule = task.schedule === "today" ? "later" : "today";
  task.updatedAt = new Date().toISOString();
  await persistTasks();
  renderTasks();
}

async function openTaskResult(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task?.conversationId) return showToast("这个任务还没有可回看的结果。", true);
  closeTaskDesk();
  const button = document.querySelector(`.conversation-item[data-id="${cssEscape(task.conversationId)}"]`);
  if (!button) return showToast("对应对话可能已被删除。", true);
  button.click();
}

async function toggleTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.status === "running") return;
  const done = task.status === "done";
  task.status = done ? "inbox" : "done";
  task.completedAt = done ? null : new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  if (readActiveTaskMarker()?.id === taskId) clearActiveTaskMarker();
  await persistTasks();
  renderTasks();
}

async function deleteTask(taskId) {
  const task = tasks.find((item) => item.id === taskId);
  if (!task || task.status === "running") return;
  if (!window.confirm(`删除任务“${task.title.slice(0, 50)}”？`)) return;
  tasks = tasks.filter((item) => item.id !== taskId);
  if (readActiveTaskMarker()?.id === taskId) clearActiveTaskMarker();
  await persistTasks();
  renderTasks();
}

function renderTasks() {
  const list = document.getElementById("taskList");
  if (!list) return;

  const sorted = [...tasks].sort(compareTasks);
  const filtered = sorted.filter((task) => {
    if (activeFilter === "today") return task.status !== "done" && task.schedule === "today";
    if (activeFilter === "done") return task.status === "done";
    if (activeFilter === "open") return task.status !== "done";
    return true;
  });

  const emptyText = activeFilter === "done"
    ? "还没有完成的任务。"
    : activeFilter === "today"
      ? "今天还没有任务。人类偶尔也会遇到这种奇迹。"
      : "还没有待处理任务。";
  list.innerHTML = filtered.length
    ? filtered.map(renderTaskItem).join("")
    : `<div class="task-empty">${emptyText}</div>`;

  const todayCount = tasks.filter((task) => task.status !== "done" && task.schedule === "today").length;
  const openCount = tasks.filter((task) => task.status !== "done").length;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  setText("todayTaskCount", todayCount);
  setText("openTaskCount", openCount);
  setText("doneTaskCount", doneCount);
  setText("taskInboxCount", todayCount || openCount);
  document.getElementById("openTasksButton")?.setAttribute("title", `${todayCount} 个今天任务，${openCount} 个未完成`);
}

function compareTasks(a, b) {
  const statusRank = (task) => task.status === "running" ? 0 : task.status === "inbox" ? 1 : 2;
  const priorityRank = { high: 0, normal: 1, low: 2 };
  const scheduleRank = { today: 0, later: 1 };
  return statusRank(a) - statusRank(b)
    || priorityRank[a.priority] - priorityRank[b.priority]
    || scheduleRank[a.schedule] - scheduleRank[b.schedule]
    || String(b.updatedAt).localeCompare(String(a.updatedAt));
}

function renderTaskItem(task) {
  const statusLabel = task.status === "done" ? "已完成" : task.status === "running" ? "处理中" : "待处理";
  const recipeLabel = task.preferredRecipe === "delegate" ? "分工" : "直办";
  const priorityLabel = { high: "高优先", normal: "普通", low: "低优先" }[task.priority];
  const scheduleLabel = task.schedule === "today" ? "今天" : "以后";
  const result = task.resultSummary
    ? `<div class="task-result-preview"><strong>结果</strong><span>${escapeHtml(task.resultSummary)}</span></div>`
    : "";
  const error = task.lastError
    ? `<div class="task-error-preview">${escapeHtml(task.lastError)}</div>`
    : "";
  const disabled = task.status === "running" ? "disabled" : "";

  return `<article class="task-item ${escapeHtml(task.status)} priority-${escapeHtml(task.priority)}" data-task-id="${escapeHtml(task.id)}">
    <div class="task-item-head">
      <span class="task-status">${statusLabel}</span>
      <div class="task-meta-badges"><small>${recipeLabel}</small><small>${scheduleLabel}</small><small>${priorityLabel}</small></div>
    </div>
    <p>${escapeHtml(task.title)}</p>
    ${result}
    ${error}
    <div class="task-item-actions">
      ${task.conversationId ? '<button type="button" data-task-action="view">查看结果</button>' : ""}
      ${task.status === "running" ? '<button type="button" disabled>处理中</button>' : '<button type="button" data-task-action="run">直办</button><button type="button" data-task-action="delegate">分工</button>'}
      <button type="button" data-task-action="edit" ${disabled}>编辑</button>
      <button type="button" data-task-action="priority" ${disabled}>优先级</button>
      <button type="button" data-task-action="schedule" ${disabled}>${task.schedule === "today" ? "移到以后" : "放到今天"}</button>
      <button type="button" data-task-action="toggle" ${disabled}>${task.status === "done" ? "重新打开" : "完成"}</button>
      <button type="button" data-task-action="delete" class="task-delete" ${disabled}>删除</button>
    </div>
  </article>`;
}

function observeResults() {
  const messages = document.getElementById("messages");
  const status = document.getElementById("chatStatus");
  const scheduleCheck = () => {
    clearTimeout(taskObserverTimer);
    taskObserverTimer = setTimeout(async () => {
      decorateTaskActions();
      decorateWelcome();
      await completeActiveTaskFromResult();
    }, 260);
  };
  if (messages) {
    const observer = new MutationObserver(scheduleCheck);
    observer.observe(messages, { childList: true, subtree: true });
  }
  if (status) {
    const observer = new MutationObserver(scheduleCheck);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  }
}

function decorateWelcome() {
  const welcome = document.getElementById("welcome");
  const grid = welcome?.querySelector(".recipe-grid");
  if (!welcome || !grid) return;
  welcome.querySelector("h2")?.replaceChildren(document.createTextNode("小事直办，大事分工。"));
  grid.classList.add("recipe-grid-six");

  const presets = [
    { recipe: "task", title: "小事直办", description: "写、改、整理、提取", prompt: "直接帮我完成这件小事，给可直接使用的结果：" },
    { recipe: "delegate", title: "智能分工", description: "拆任务、并行、汇总", prompt: "把这件事分工给合适的 Agent 并行处理，再汇总交付：" }
  ];
  presets.reverse().forEach((preset) => {
    if (grid.querySelector(`[data-recipe="${preset.recipe}"]`)) return;
    const button = document.createElement("button");
    button.className = "recipe-card";
    button.dataset.recipe = preset.recipe;
    button.dataset.prompt = preset.prompt;
    button.innerHTML = `<strong>${preset.title}</strong><small>${preset.description}</small>`;
    button.addEventListener("click", () => {
      const picker = document.getElementById("recipePicker");
      const input = document.getElementById("chatInput");
      if (!picker || !input) return;
      picker.value = preset.recipe;
      input.value = preset.prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    });
    grid.prepend(button);
  });
}

function decorateTaskActions() {
  document.querySelectorAll(".message.assistant .result-actions").forEach((actions) => {
    if (actions.querySelector('[data-task-result-action="extract"]')) return;
    const row = actions.querySelector(".action-row");
    if (!row) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.taskResultAction = "extract";
    button.textContent = "加入任务台";
    button.addEventListener("click", () => addNextStepsFromMessage(actions.closest(".message"), button));
    row.append(button);
  });
}

async function addNextStepsFromMessage(messageNode, button) {
  const content = messageNode?.querySelector(".bubble")?.innerText?.trim();
  if (!content) return showToast("没有可提取的任务。", true);
  const nextSteps = extractNextSteps(content);
  if (!nextSteps.length) return showToast("没有识别到明确的下一步。", true);

  const existing = new Set(tasks.map((task) => normalizeTaskText(task.title)));
  const additions = nextSteps
    .filter((title) => !existing.has(normalizeTaskText(title)))
    .map((title) => createTask(title, "task", { schedule: "today", priority: "normal" }));

  if (!additions.length) return showToast("这些下一步已经在任务台里。", true);
  tasks.unshift(...additions);
  await persistTasks();
  renderTasks();
  button.textContent = `已加入 ${additions.length} 项`;
  button.disabled = true;
  showToast(`已加入 ${additions.length} 个今天任务`);
}

function extractNextSteps(content) {
  const normalized = String(content || "").replace(/\r/g, "");
  const section = normalized.match(/(?:^|\n)(?:下一步行动|下一步|执行步骤|修复顺序|下一步验证|分工与交付)\s*[：:]?\s*\n([\s\S]*?)(?=\n(?:仍有争议|风险|风险与回退|必要说明|关键原因|代价与风险|依赖和交接|验收标准)\s*[：:]?|$)/i)?.[1] || "";
  const source = section || normalized;
  const lines = source
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, "").trim())
    .filter((line) => line.length >= 4 && line.length <= 240)
    .filter((line) => !/^(结论|关键原因|必要说明|总体判断|风险)/.test(line));
  return Array.from(new Set(lines)).slice(0, 8);
}

async function completeActiveTaskFromResult() {
  const marker = readActiveTaskMarker();
  if (!marker) return;
  if (!document.getElementById("stopButton")?.classList.contains("hidden")) return;

  const statusText = document.getElementById("chatStatus")?.textContent || "";
  if (/(发送失败|已停止)/.test(statusText)) {
    await reopenActiveTask(marker.id, statusText);
    return;
  }

  const resultNodes = Array.from(document.querySelectorAll(".message.assistant .result-actions"));
  if (resultNodes.length <= Number(marker.baselineResults || 0)) return;

  const conversationId = document.querySelector(".conversation-item.active")?.dataset.id || null;
  if (!conversationId && Number(marker.attempts || 0) < 8) {
    marker.attempts = Number(marker.attempts || 0) + 1;
    writeActiveTaskMarker(marker);
    setTimeout(completeActiveTaskFromResult, 180);
    return;
  }

  const task = tasks.find((item) => item.id === marker.id);
  if (!task || task.status !== "running") {
    clearActiveTaskMarker();
    return;
  }
  const latestResult = resultNodes.at(-1)?.closest(".message")?.querySelector(".bubble")?.innerText?.trim() || "";
  task.status = "done";
  task.completedAt = new Date().toISOString();
  task.updatedAt = task.completedAt;
  task.conversationId = conversationId;
  task.resultSummary = summarizeResult(latestResult);
  task.lastError = "";
  clearActiveTaskMarker();
  await persistTasks();
  renderTasks();
  showToast("任务完成，结果已关联到任务卡");
}

async function reopenActiveTask(taskId, error = "") {
  const task = tasks.find((item) => item.id === taskId);
  if (task?.status === "running") {
    task.status = "inbox";
    task.updatedAt = new Date().toISOString();
    task.lastError = String(error || "任务未完成，可重新执行").slice(0, 300);
    await persistTasks();
    renderTasks();
  }
  clearActiveTaskMarker();
}

async function restoreInterruptedTask() {
  const marker = readActiveTaskMarker();
  if (!marker) return;
  await reopenActiveTask(marker.id, "上次运行被页面刷新或关闭中断");
}

async function loadTasks() {
  const record = await getRecord("settings", RECORD_ID);
  return Array.isArray(record?.items) ? record.items : [];
}

async function persistTasks() {
  await putRecord("settings", { id: RECORD_ID, items: tasks });
}

function writeActiveTaskMarker(marker) {
  sessionStorage.setItem(ACTIVE_TASK_KEY, JSON.stringify(marker));
}

function readActiveTaskMarker() {
  const raw = sessionStorage.getItem(ACTIVE_TASK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return { id: raw, baselineResults: 0, attempts: 0 };
  }
}

function clearActiveTaskMarker() {
  sessionStorage.removeItem(ACTIVE_TASK_KEY);
}

function normalizePriority(value) {
  return PRIORITY_ORDER.includes(value) ? value : "normal";
}

function normalizeSchedule(value) {
  return value === "later" ? "later" : "today";
}

function normalizeTaskText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function summarizeResult(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(text, error = false) {
  const box = document.getElementById("toast");
  if (!box) return;
  box.textContent = text;
  box.className = `toast${error ? " error" : ""}`;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 2800);
}
