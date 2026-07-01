import type {
  CouncilMember,
  DiscussionQuestion,
  MemberPosition,
  MemberResponse,
  ModeratorDigest
} from "./types.js";
import type { NormalizedCouncilConfig } from "./validation.js";

function fenced(label: string, value: unknown): string {
  return `<${label}>\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n</${label}>`;
}

function memberIdentity(member: CouncilMember): string {
  return [
    `你是圆桌会议成员「${member.name}」。`,
    `职位：${member.role}`,
    `专长：${member.expertise.join("、")}`,
    `工作原则：${member.instructions}`,
    "只给出可审查的结论、依据、风险和问题；不要输出隐藏推理过程。",
    "独立判断，不迎合主持人或其他成员。"
  ].join("\n");
}

export function buildFirstRoundPrompt(config: NormalizedCouncilConfig, member: CouncilMember): string {
  return [
    memberIdentity(member),
    "这是第一轮独立发言。你看不到其他成员的答案。",
    "请充分发挥自己的专业长处，对议题形成明确立场。",
    fenced("meeting_title", config.title),
    fenced("problem", config.problem),
    fenced("context", config.context || "无补充背景"),
    `返回 memberId 时必须填写：${member.id}`
  ].join("\n\n");
}

export function buildDigestPrompt(
  config: NormalizedCouncilConfig,
  moderator: CouncilMember,
  positions: MemberPosition[]
): string {
  return [
    memberIdentity(moderator),
    "你现在担任会议主持人。请压缩首轮意见，提取真实共识、关键分歧和缺失信息。",
    "只在存在值得进一步讨论的分歧或信息缺口时，将 needsDiscussion 设为 true。",
    "questions 必须定向给最适合回答的成员；targetMemberIds 只能使用现有 memberId。",
    "避免重复原文，避免为了制造热闹而虚构分歧。",
    fenced("meeting_problem", config.problem),
    fenced("first_round_positions", positions)
  ].join("\n\n");
}

export function selectQuestionsForMember(questions: DiscussionQuestion[], memberId: string): DiscussionQuestion[] {
  return questions.filter((question) => question.targetMemberIds.includes(memberId));
}

export function buildSecondRoundPrompt(
  config: NormalizedCouncilConfig,
  member: CouncilMember,
  ownPosition: MemberPosition,
  digest: ModeratorDigest,
  questions: DiscussionQuestion[],
  relevantPositions: MemberPosition[]
): string {
  return [
    memberIdentity(member),
    "这是第二轮定向商议。请回应主持人分配给你的问题，并根据新信息修正或坚持立场。",
    "必须明确：同意什么、反对什么、立场是否变化。不要重新复述整份首轮意见。",
    fenced("meeting_problem", config.problem),
    fenced("your_first_position", ownPosition),
    fenced("meeting_consensus", digest.consensus),
    fenced("meeting_disagreements", digest.disagreements),
    fenced("questions_for_you", questions),
    fenced("relevant_positions", relevantPositions),
    `返回 memberId 时必须填写：${member.id}`
  ].join("\n\n");
}

export function buildFinalPrompt(
  config: NormalizedCouncilConfig,
  moderator: CouncilMember,
  positions: MemberPosition[],
  digest: ModeratorDigest,
  responses: MemberResponse[]
): string {
  return [
    memberIdentity(moderator),
    "你现在进行最终仲裁。最终结论应综合专业意见，但不能简单按多数投票。",
    "优先采用证据充分、风险可控、可执行的观点。明确记录被采纳和被否决的关键意见。",
    "若信息不足，应把问题写入 unresolved，不要装作已经解决。",
    fenced("meeting_title", config.title),
    fenced("problem", config.problem),
    fenced("context", config.context || "无补充背景"),
    fenced("first_round", positions),
    fenced("moderator_digest", digest),
    fenced("second_round", responses)
  ].join("\n\n");
}
