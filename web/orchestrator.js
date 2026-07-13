export const RUN_MODES = new Set(["auto", "quick", "advisor", "debate"]);

export const RECIPES = {
  auto: {
    id: "auto",
    label: "自动判断",
    capabilities: [],
    round1Prompt: "",
    round2Prompt: "",
    finalSections: ["结论", "关键原因", "下一步行动", "仍有争议"]
  },
  general: {
    id: "general",
    label: "普通问答",
    capabilities: ["writing"],
    round1Prompt: "给出直接、准确、能解决问题的判断。",
    round2Prompt: "检查回答是否遗漏关键条件，并给出必要修正。",
    finalSections: ["结论", "关键说明", "下一步"]
  },
  decision: {
    id: "decision",
    label: "做决策",
    capabilities: ["decision", "review"],
    round1Prompt: "给出明确选择，说明收益、代价、关键假设和最大风险。",
    round2Prompt: "审查对方判断中的盲点、机会成本和不可逆风险，再修正自己的选择。",
    finalSections: ["结论", "关键原因", "代价与风险", "下一步行动"]
  },
  review: {
    id: "review",
    label: "审方案",
    capabilities: ["review", "technical", "research"],
    round1Prompt: "集中寻找漏洞、错误假设、遗漏条件、执行风险和可验证问题。",
    round2Prompt: "对照其他审查意见，合并重复问题，保留最关键的缺口并给出修复优先级。",
    finalSections: ["总体判断", "必须修的问题", "可以后补的问题", "修复顺序"]
  },
  plan: {
    id: "plan",
    label: "拆执行计划",
    capabilities: ["planning", "technical", "decision"],
    round1Prompt: "把目标拆成里程碑、具体任务、依赖、验收标准和风险。",
    round2Prompt: "检查计划是否过大、缺少依赖或无法验收，并压缩成最短可执行路径。",
    finalSections: ["目标", "执行步骤", "验收标准", "风险与回退"]
  },
  creative: {
    id: "creative",
    label: "创意发散",
    capabilities: ["creative", "writing", "research"],
    round1Prompt: "提出差异明显的方向，避免同义改写，并说明每个方向的亮点和风险。",
    round2Prompt: "淘汰平庸或重复方向，组合最强元素，形成更鲜明的最终方案。",
    finalSections: ["核心创意", "候选方向", "推荐方案", "下一步验证"]
  }
};

export function normalizeRunMode(value) {
  return RUN_MODES.has(value) ? value : "auto";
}

export function normalizeRecipe(value) {
  return RECIPES[value] ? value : "auto";
}

export function getRecipe(value) {
  return RECIPES[normalizeRecipe(value)];
}

export function routeTask({ text, requestedMode = "auto", requestedRecipe = "auto", availableAgents = 1 }) {
  const source = String(text || "").trim();
  const lower = source.toLowerCase();
  let recipe = normalizeRecipe(requestedRecipe);
  let reason = "用户手动选择任务类型";

  if (recipe === "auto") {
    if (/(计划|步骤|todo|to-do|拆解|执行|里程碑|codex|怎么做|如何做|实现|开发|搭建|写代码|改代码)/i.test(source)) {
      recipe = "plan";
      reason = "检测到执行、拆解或实现诉求";
    } else if (/(review|审查|检查|漏洞|优化|风险|bug|报错|错误|哪里有问题|有什么问题|代码审查|架构审查)/i.test(source)) {
      recipe = "review";
      reason = "检测到审查、风险或技术问题";
    } else if (/(创意|世界观|剧情|选题|发散|名字|命名|点子|设计)/i.test(source)) {
      recipe = "creative";
      reason = "检测到创意或发散诉求";
    } else if (/(要不要|该不该|值不值得|选择|优先|决策|判断|取舍|哪个好|方案)/i.test(source)) {
      recipe = "decision";
      reason = "检测到决策或取舍诉求";
    } else {
      recipe = "general";
      reason = "识别为普通问答";
    }
  }

  let mode = normalizeRunMode(requestedMode);
  if (mode === "auto") {
    const explicitDebate = /(碰撞|讨论|反驳|辩论|多轮|深度|全面|榨干|不同观点)/i.test(source);
    const shortSimple = source.length < 80 && recipe === "general";
    if (availableAgents < 2 || shortSimple) {
      mode = "quick";
      reason += availableAgents < 2 ? "；只有一个可用 Agent" : "；问题较短且直接";
    } else if (explicitDebate) {
      mode = "debate";
      reason += "；用户明确要求多观点碰撞";
    } else if (recipe === "decision" || recipe === "review" || recipe === "plan" || recipe === "creative") {
      mode = "advisor";
      reason += "；需要一次独立审查";
    } else {
      mode = lower.includes("为什么") && source.length > 120 ? "advisor" : "quick";
      reason += mode === "advisor" ? "；问题信息量较大" : "；直接回答更高效";
    }
  }

  return {
    mode,
    recipe,
    reason,
    label: `${getRecipe(recipe).label} · ${modeLabel(mode)}`
  };
}

export function selectParticipants({ providers, primaryId, agentProfiles = {}, maxAgents = 2, recipe = "general" }) {
  const primary = providers.find((provider) => provider.id === primaryId) || providers[0] || null;
  if (!primary) return [];

  const limit = Math.max(1, Math.min(Number(maxAgents) || 2, 6));
  const wanted = new Set(getRecipe(recipe).capabilities);
  const enabled = providers
    .filter((provider) => provider.id === primary.id || agentProfiles[provider.id]?.participatesInDebate !== false)
    .map((provider, index) => ({
      provider,
      index,
      score: scoreAgent(agentProfiles[provider.id], wanted)
    }));

  const rest = enabled
    .filter((item) => item.provider.id !== primary.id)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.provider);

  return [primary, ...rest].slice(0, limit);
}

function scoreAgent(profile = {}, wanted) {
  const capabilities = normalizeCapabilities(profile.capabilities);
  let score = 0;
  capabilities.forEach((capability) => {
    if (wanted.has(capability)) score += 3;
  });
  if (capabilities.includes("review")) score += 0.5;
  return score;
}

function normalizeCapabilities(value) {
  if (Array.isArray(value)) return value.map(String);
  return String(value || "").split(/[,，\s]+/).filter(Boolean);
}

export function buildRoundContext({ providerId, previousNotes = [] }) {
  const ownNote = previousNotes.find((note) => note.providerId === providerId) || null;
  const peerNotes = previousNotes.filter((note) => note.providerId !== providerId);
  return { ownNote, peerNotes };
}

export function estimateCallCount({ mode, participantCount, rounds = 2 }) {
  const normalized = normalizeRunMode(mode);
  const count = Math.max(1, Number(participantCount) || 1);
  if (normalized === "auto") return count > 1 ? 2 : 1;
  if (normalized === "quick" || count < 2) return 1;
  if (normalized === "advisor") return count;
  return count * Math.max(1, Math.min(Number(rounds) || 2, 2)) + 1;
}

export function createRun({ conversationId, mode, recipe, routeReason, participants }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    conversationId,
    mode,
    recipe: normalizeRecipe(recipe),
    routeReason: routeReason || "",
    participants: participants.map((provider) => provider.id),
    status: "running",
    startedAt: now,
    completedAt: null,
    cancelledAt: null,
    steps: [],
    usage: { totalTokens: 0, calls: 0, elapsedMs: 0 },
    feedback: null,
    error: null
  };
}

export function addRunStep(run, step) {
  run.steps.push({
    id: step.id || crypto.randomUUID(),
    providerId: step.providerId || "system",
    title: step.title || "步骤",
    state: step.state || "pending",
    content: step.content || "",
    startedAt: step.startedAt || new Date().toISOString(),
    completedAt: step.completedAt || null,
    usage: step.usage || 0,
    elapsedMs: step.elapsedMs || 0
  });
  return run.steps.at(-1);
}

export function updateRunStep(run, stepId, patch) {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) return null;
  Object.assign(step, patch);
  return step;
}

export function finishRun(run, { status = "completed", error = null } = {}) {
  run.status = status;
  run.error = error;
  const now = new Date().toISOString();
  if (status === "cancelled") run.cancelledAt = now;
  else run.completedAt = now;
  run.usage = run.steps.reduce((summary, step) => {
    summary.totalTokens += Number(step.usage) || 0;
    summary.calls += step.providerId === "system" || step.providerId === "input" ? 0 : 1;
    summary.elapsedMs += Number(step.elapsedMs) || 0;
    return summary;
  }, { totalTokens: 0, calls: 0, elapsedMs: 0 });
  return run;
}

export function modeLabel(mode) {
  return ({
    auto: "自动模式",
    quick: "快速模式",
    advisor: "参谋模式",
    debate: "深度碰撞"
  })[normalizeRunMode(mode)];
}
