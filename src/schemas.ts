export const memberPositionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["memberId", "position", "reasons", "risks", "questions", "confidence"],
  properties: {
    memberId: { type: "string" },
    position: { type: "string" },
    reasons: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

export const moderatorDigestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["consensus", "disagreements", "missingInformation", "questions", "needsDiscussion"],
  properties: {
    consensus: { type: "array", items: { type: "string" } },
    disagreements: { type: "array", items: { type: "string" } },
    missingInformation: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "targetMemberIds", "relevantMemberIds"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          targetMemberIds: { type: "array", items: { type: "string" } },
          relevantMemberIds: { type: "array", items: { type: "string" } }
        }
      }
    },
    needsDiscussion: { type: "boolean" }
  }
} as const;

export const memberResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["memberId", "response", "revisedPosition", "agreements", "objections", "confidence"],
  properties: {
    memberId: { type: "string" },
    response: { type: "string" },
    revisedPosition: { type: "string" },
    agreements: { type: "array", items: { type: "string" } },
    objections: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;

export const finalDecisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "decision", "rationale", "acceptedPoints", "rejectedPoints", "unresolved", "nextActions", "confidence"],
  properties: {
    summary: { type: "string" },
    decision: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    acceptedPoints: { type: "array", items: { type: "object", additionalProperties: false, required: ["memberId", "point"], properties: { memberId: { type: "string" }, point: { type: "string" } } } },
    rejectedPoints: { type: "array", items: { type: "object", additionalProperties: false, required: ["memberId", "point", "reason"], properties: { memberId: { type: "string" }, point: { type: "string" }, reason: { type: "string" } } } },
    unresolved: { type: "array", items: { type: "string" } },
    nextActions: { type: "array", items: { type: "object", additionalProperties: false, required: ["owner", "action", "priority"], properties: { owner: { type: "string" }, action: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] } } } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
} as const;
