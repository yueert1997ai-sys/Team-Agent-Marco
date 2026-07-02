export type CouncilAccess = "read" | "write";

export interface CouncilMember {
  id: string;
  name: string;
  role: string;
  expertise: string[];
  instructions: string;
  model?: string;
  agentType?: string;
  access?: CouncilAccess;
  enabled?: boolean;
}

export interface CouncilConfig {
  title: string;
  problem: string;
  context?: string;
  moderatorId: string;
  members: CouncilMember[];
  maxRounds?: 1 | 2;
  maxOutputTokensPerTurn?: number;
  totalBudgetTokens?: number;
  minSuccessfulMembers?: number;
  forceSecondRound?: boolean;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentCallOptions {
  label: string;
  model?: string;
  agentType?: string;
  access: CouncilAccess;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

export interface AgentCallResult<T> {
  value: T;
  usage?: AgentUsage;
}

export interface CouncilAgentExecutor {
  call<T>(prompt: string, options: AgentCallOptions): Promise<AgentCallResult<T>>;
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<T | null>>;
}

export interface MemberPosition {
  memberId: string;
  position: string;
  reasons: string[];
  risks: string[];
  questions: string[];
  confidence: number;
}

export interface DiscussionQuestion {
  id: string;
  question: string;
  targetMemberIds: string[];
  relevantMemberIds: string[];
}

export interface ModeratorDigest {
  consensus: string[];
  disagreements: string[];
  missingInformation: string[];
  questions: DiscussionQuestion[];
  needsDiscussion: boolean;
}

export interface MemberResponse {
  memberId: string;
  response: string;
  revisedPosition: string;
  agreements: string[];
  objections: string[];
  confidence: number;
}

export interface FinalDecision {
  summary: string;
  decision: string;
  rationale: string[];
  acceptedPoints: Array<{ memberId: string; point: string }>;
  rejectedPoints: Array<{ memberId: string; point: string; reason: string }>;
  unresolved: string[];
  nextActions: Array<{ owner: string; action: string; priority: "high" | "medium" | "low" }>;
  confidence: number;
}

export interface CouncilMeetingResult {
  meetingId: string;
  title: string;
  firstRound: MemberPosition[];
  digest: ModeratorDigest;
  secondRound: MemberResponse[];
  finalDecision: FinalDecision;
  failedMembers: Array<{ memberId: string; stage: "first" | "second"; error: string }>;
  estimatedUsageTokens: number;
}

export type CouncilEvent =
  | { type: "meeting_started"; meetingId: string; title: string }
  | { type: "stage_started"; stage: "first" | "digest" | "second" | "final" }
  | { type: "member_completed"; stage: "first" | "second"; memberId: string }
  | { type: "member_failed"; stage: "first" | "second"; memberId: string; error: string }
  | { type: "meeting_completed"; meetingId: string };

export interface CouncilRunnerOptions {
  now?: () => number;
  randomId?: () => string;
  onEvent?: (event: CouncilEvent) => void;
}
