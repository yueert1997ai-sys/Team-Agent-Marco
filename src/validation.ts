import type { CouncilConfig, CouncilMember } from "./types.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 500;
const DEFAULT_MIN_SUCCESSFUL_MEMBERS = 2;

export interface NormalizedCouncilConfig extends CouncilConfig {
  maxRounds: 1 | 2;
  maxOutputTokensPerTurn: number;
  minSuccessfulMembers: number;
  forceSecondRound: boolean;
  members: CouncilMember[];
}

export function normalizeCouncilConfig(config: CouncilConfig): NormalizedCouncilConfig {
  if (!config || typeof config !== "object") throw new Error("Council config is required.");
  if (!config.title?.trim()) throw new Error("Council title is required.");
  if (!config.problem?.trim()) throw new Error("Council problem is required.");

  const members = config.members.filter((member) => member.enabled !== false);
  if (members.length < 2) throw new Error("Council requires at least two enabled members.");
  if (members.length > 8) throw new Error("Council supports at most eight enabled members.");

  const ids = new Set<string>();
  for (const member of members) validateMember(member, ids);

  if (!ids.has(config.moderatorId)) {
    throw new Error(`Moderator ${JSON.stringify(config.moderatorId)} is not an enabled council member.`);
  }

  const maxRounds = config.maxRounds ?? 2;
  if (maxRounds !== 1 && maxRounds !== 2) throw new Error("maxRounds must be 1 or 2.");

  const maxOutputTokensPerTurn = config.maxOutputTokensPerTurn ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(maxOutputTokensPerTurn) || maxOutputTokensPerTurn < 100 || maxOutputTokensPerTurn > 4000) {
    throw new Error("maxOutputTokensPerTurn must be an integer between 100 and 4000.");
  }

  const firstRoundMemberCount = Math.max(1, members.length - 1);
  const minSuccessfulMembers = config.minSuccessfulMembers
    ?? Math.min(DEFAULT_MIN_SUCCESSFUL_MEMBERS, firstRoundMemberCount);
  if (!Number.isInteger(minSuccessfulMembers) || minSuccessfulMembers < 1 || minSuccessfulMembers > firstRoundMemberCount) {
    throw new Error("minSuccessfulMembers must be between 1 and the first-round participant count.");
  }

  if (config.totalBudgetTokens != null) {
    if (!Number.isInteger(config.totalBudgetTokens) || config.totalBudgetTokens < 500) {
      throw new Error("totalBudgetTokens must be an integer of at least 500 when provided.");
    }
  }

  return {
    ...config,
    title: config.title.trim(),
    problem: config.problem.trim(),
    ...(config.context?.trim() ? { context: config.context.trim() } : {}),
    members,
    maxRounds,
    maxOutputTokensPerTurn,
    minSuccessfulMembers,
    forceSecondRound: config.forceSecondRound ?? false
  };
}

function validateMember(member: CouncilMember, ids: Set<string>): void {
  if (!member.id?.trim()) throw new Error("Every council member requires an id.");
  if (ids.has(member.id)) throw new Error(`Duplicate council member id: ${member.id}`);
  ids.add(member.id);

  if (!member.name?.trim()) throw new Error(`Council member ${member.id} requires a name.`);
  if (!member.role?.trim()) throw new Error(`Council member ${member.id} requires a role.`);
  if (!member.instructions?.trim()) throw new Error(`Council member ${member.id} requires instructions.`);
  if (!Array.isArray(member.expertise) || member.expertise.length === 0) {
    throw new Error(`Council member ${member.id} requires at least one expertise item.`);
  }
  if (member.access && member.access !== "read" && member.access !== "write") {
    throw new Error(`Council member ${member.id} access must be read or write.`);
  }
}
