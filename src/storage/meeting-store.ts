import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CouncilMeetingResult } from "../types.js";

export interface SavedMeetingPaths {
  jsonPath: string;
  markdownPath: string;
}

export async function saveMeetingResult(
  result: CouncilMeetingResult,
  outputDir: string,
  metadata: Record<string, unknown> = {}
): Promise<SavedMeetingPaths> {
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = slugify(result.title).slice(0, 48) || "meeting";
  const baseName = `${stamp}-${slug}`;
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const markdownPath = path.join(outputDir, `${baseName}.md`);

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify({ metadata, result }, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderMeetingMarkdown(result, metadata), "utf8")
  ]);

  return { jsonPath, markdownPath };
}

export function renderMeetingMarkdown(
  result: CouncilMeetingResult,
  metadata: Record<string, unknown> = {}
): string {
  const lines = [
    `# ${result.title}`,
    "",
    `- Meeting ID: \`${result.meetingId}\``,
    `- Estimated tokens: ${result.estimatedUsageTokens}`,
    `- Failed member turns: ${result.failedMembers.length}`
  ];

  for (const [key, value] of Object.entries(metadata)) {
    lines.push(`- ${key}: ${formatInline(value)}`);
  }

  lines.push("", "## 最终决定", "", result.finalDecision.decision, "", "## 摘要", "", result.finalDecision.summary);
  lines.push("", "## 依据", "", ...asBullets(result.finalDecision.rationale));
  lines.push("", "## 下一步", "");
  for (const action of result.finalDecision.nextActions) {
    lines.push(`- **${action.priority.toUpperCase()}** · ${action.owner}: ${action.action}`);
  }

  if (result.finalDecision.unresolved.length > 0) {
    lines.push("", "## 未解决问题", "", ...asBullets(result.finalDecision.unresolved));
  }

  lines.push("", "## 首轮意见", "");
  for (const position of result.firstRound) {
    lines.push(`### ${position.memberId}`, "", position.position, "", ...asBullets(position.reasons), "");
  }

  if (result.secondRound.length > 0) {
    lines.push("## 第二轮回应", "");
    for (const response of result.secondRound) {
      lines.push(`### ${response.memberId}`, "", response.response, "", `修正立场：${response.revisedPosition}`, "");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function asBullets(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- 无"];
}

function formatInline(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return `\`${JSON.stringify(value)}\``;
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
