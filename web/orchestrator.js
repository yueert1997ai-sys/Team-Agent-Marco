export const RUN_MODES = new Set(["quick", "advisor", "debate"]);

export function normalizeRunMode(value) {
  return RUN_MODES.has(value) ? value : "debate";
}

export function selectParticipants({ providers, primaryId, agentProfiles = {}, maxAgents = 2 }) {
  const primary = providers.find((provider) => provider.id === primaryId) || providers[0] || null;
  if (!primary) return [];
  const limit = Math.max(1, Math.min(Number(maxAgents) || 2, 6));
  const enabled = providers.filter((provider) => {
    if (provider.id === primary.id) return true;
    return agentProfiles[provider.id]?.participatesInDebate !== false;
  });
  return [primary, ...enabled.filter((provider) => provider.id !== primary.id)].slice(0, limit);
}

export function buildRoundContext({ providerId, previousNotes = [] }) {
  const ownNote = previousNotes.find((note) => note.providerId === providerId) || null;
  const peerNotes = previousNotes.filter((note) => note.providerId !== providerId);
  return { ownNote, peerNotes };
}

export function estimateCallCount({ mode, participantCount, rounds = 2 }) {
  const count = Math.max(1, Number(participantCount) || 1);
  if (mode === "quick" || count < 2) return 1;
  if (mode === "advisor") return count;
  return count * Math.max(1, Math.min(Number(rounds) || 2, 2)) + 1;
}

export function createRun({ conversationId, mode, participants }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    conversationId,
    mode,
    participants: participants.map((provider) => provider.id),
    status: "running",
    startedAt: now,
    completedAt: null,
    cancelledAt: null,
    steps: [],
    usage: { totalTokens: 0, calls: 0, elapsedMs: 0 },
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
