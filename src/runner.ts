import {
  finalDecisionSchema,
  memberPositionSchema,
  memberResponseSchema,
  moderatorDigestSchema
} from "./schemas.js";
import {
  buildDigestPrompt,
  buildFinalPrompt,
  buildFirstRoundPrompt,
  buildSecondRoundPrompt,
  selectQuestionsForMember
} from "./prompts.js";
import { normalizeCouncilConfig } from "./validation.js";
import type {
  AgentCallOptions,
  AgentUsage,
  CouncilAgentExecutor,
  CouncilConfig,
  CouncilMeetingResult,
  CouncilMember,
  CouncilRunnerOptions,
  FinalDecision,
  MemberPosition,
  MemberResponse,
  ModeratorDigest
} from "./types.js";

export class CouncilMeetingError extends Error {
  constructor(message: string, readonly causeData?: unknown) {
    super(message);
    this.name = "CouncilMeetingError";
  }
}

export async function runCouncilMeeting(
  rawConfig: CouncilConfig,
  executor: CouncilAgentExecutor,
  options: CouncilRunnerOptions = {}
): Promise<CouncilMeetingResult> {
  const config = normalizeCouncilConfig(rawConfig);
  const randomId = options.randomId ?? (() => Math.random().toString(36).slice(2, 10));
  const now = options.now ?? Date.now;
  const emit = options.onEvent ?? (() => undefined);
  const meetingId = `council-${now()}-${randomId()}`;
  const failedMembers: CouncilMeetingResult["failedMembers"] = [];
  let estimatedUsageTokens = 0;

  emit({ type: "meeting_started", meetingId, title: config.title });

  const moderator = findMember(config.members, config.moderatorId);
  const participants = config.members.filter((member) => member.id !== config.moderatorId);
  const firstRoundMembers = participants.length > 0 ? participants : [moderator];

  emit({ type: "stage_started", stage: "first" });
  const firstResults = await executor.parallel(firstRoundMembers.map((member) => async () => {
    try {
      const result = await executor.call<MemberPosition>(
        buildFirstRoundPrompt(config, member),
        callOptions(member, `首轮 · ${member.name}`, memberPositionSchema, config.maxOutputTokensPerTurn)
      );
      estimatedUsageTokens += usageTotal(result.usage);
      assertMemberId(result.value.memberId, member.id, "first");
      emit({ type: "member_completed", stage: "first", memberId: member.id });
      return result.value;
    } catch (error) {
      const message = errorMessage(error);
      failedMembers.push({ memberId: member.id, stage: "first", error: message });
      emit({ type: "member_failed", stage: "first", memberId: member.id, error: message });
      return null;
    }
  }));

  const firstRound = firstResults.filter(isMemberPosition);
  enforceBudget(config.totalBudgetTokens, estimatedUsageTokens, "first round");
  if (firstRound.length < config.minSuccessfulMembers) {
    throw new CouncilMeetingError(
      `Only ${firstRound.length} first-round members succeeded; ${config.minSuccessfulMembers} required.`,
      { failedMembers }
    );
  }

  emit({ type: "stage_started", stage: "digest" });
  const digestResult = await executor.call<ModeratorDigest>(
    buildDigestPrompt(config, moderator, firstRound),
    callOptions(moderator, `主持提炼 · ${moderator.name}`, moderatorDigestSchema, config.maxOutputTokensPerTurn)
  );
  estimatedUsageTokens += usageTotal(digestResult.usage);
  enforceBudget(config.totalBudgetTokens, estimatedUsageTokens, "moderator digest");
  const digest = sanitizeDigest(digestResult.value, config.members.map((member) => member.id));

  const shouldRunSecondRound = config.maxRounds === 2 && (config.forceSecondRound || digest.needsDiscussion);
  const secondRound: MemberResponse[] = [];

  if (shouldRunSecondRound) {
    emit({ type: "stage_started", stage: "second" });
    const invited = selectInvitedMembers(firstRoundMembers, digest);
    const secondResults = await executor.parallel(invited.map((member) => async () => {
      const ownPosition = firstRound.find((position) => position.memberId === member.id);
      if (!ownPosition) return null;
      const questions = selectQuestionsForMember(digest.questions, member.id);
      const relevantIds = new Set(questions.flatMap((question) => question.relevantMemberIds));
      const relevantPositions = firstRound.filter(
        (position) => position.memberId !== member.id && (relevantIds.size === 0 || relevantIds.has(position.memberId))
      );

      try {
        const result = await executor.call<MemberResponse>(
          buildSecondRoundPrompt(config, member, ownPosition, digest, questions, relevantPositions),
          callOptions(member, `回应 · ${member.name}`, memberResponseSchema, config.maxOutputTokensPerTurn)
        );
        estimatedUsageTokens += usageTotal(result.usage);
        assertMemberId(result.value.memberId, member.id, "second");
        emit({ type: "member_completed", stage: "second", memberId: member.id });
        return result.value;
      } catch (error) {
        const message = errorMessage(error);
        failedMembers.push({ memberId: member.id, stage: "second", error: message });
        emit({ type: "member_failed", stage: "second", memberId: member.id, error: message });
        return null;
      }
    }));
    secondRound.push(...secondResults.filter(isMemberResponse));
    enforceBudget(config.totalBudgetTokens, estimatedUsageTokens, "second round");
  }

  emit({ type: "stage_started", stage: "final" });
  const finalResult = await executor.call<FinalDecision>(
    buildFinalPrompt(config, moderator, firstRound, digest, secondRound),
    callOptions(moderator, `最终仲裁 · ${moderator.name}`, finalDecisionSchema, config.maxOutputTokensPerTurn)
  );
  estimatedUsageTokens += usageTotal(finalResult.usage);

  const result: CouncilMeetingResult = {
    meetingId,
    title: config.title,
    firstRound,
    digest,
    secondRound,
    finalDecision: finalResult.value,
    failedMembers,
    estimatedUsageTokens
  };
  emit({ type: "meeting_completed", meetingId });
  return result;
}

function callOptions(
  member: CouncilMember,
  label: string,
  schema: Record<string, unknown>,
  maxOutputTokens: number
): AgentCallOptions {
  return {
    label,
    ...(member.model ? { model: member.model } : {}),
    ...(member.agentType ? { agentType: member.agentType } : {}),
    access: member.access ?? "read",
    schema,
    maxOutputTokens
  };
}

function findMember(members: CouncilMember[], memberId: string): CouncilMember {
  const member = members.find((candidate) => candidate.id === memberId);
  if (!member) throw new CouncilMeetingError(`Council member not found: ${memberId}`);
  return member;
}

function selectInvitedMembers(members: CouncilMember[], digest: ModeratorDigest): CouncilMember[] {
  const targetIds = new Set(digest.questions.flatMap((question) => question.targetMemberIds));
  if (targetIds.size === 0) return members;
  return members.filter((member) => targetIds.has(member.id));
}

function sanitizeDigest(digest: ModeratorDigest, validMemberIds: string[]): ModeratorDigest {
  const valid = new Set(validMemberIds);
  return {
    ...digest,
    questions: digest.questions
      .map((question) => ({
        ...question,
        targetMemberIds: [...new Set(question.targetMemberIds.filter((id) => valid.has(id)))],
        relevantMemberIds: [...new Set(question.relevantMemberIds.filter((id) => valid.has(id)))]
      }))
      .filter((question) => question.targetMemberIds.length > 0)
  };
}

function enforceBudget(total: number | undefined, spent: number, stage: string): void {
  if (total != null && spent >= total) {
    throw new CouncilMeetingError(`Council token budget exhausted after ${stage}: ${spent}/${total}.`);
  }
}

function usageTotal(usage?: AgentUsage): number {
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number") return usage.totalTokens;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

function assertMemberId(actual: string, expected: string, stage: string): void {
  if (actual !== expected) {
    throw new CouncilMeetingError(`${stage} response memberId mismatch: expected ${expected}, got ${actual}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMemberPosition(value: MemberPosition | null): value is MemberPosition {
  return value !== null;
}

function isMemberResponse(value: MemberResponse | null): value is MemberResponse {
  return value !== null;
}
