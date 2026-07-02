import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface MeetingHistoryItem {
  id: string;
  title: string;
  decision: string;
  summary: string;
  createdAt: string;
  tokens: number;
  filePath: string;
}

export async function listMeetingHistory(directory: string, limit = 50): Promise<MeetingHistoryItem[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const jsonFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name));

  const items = await Promise.all(jsonFiles.map(readHistoryItem));
  return items
    .filter((item): item is MeetingHistoryItem => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

async function readHistoryItem(filePath: string): Promise<MeetingHistoryItem | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
      metadata?: { startedAt?: string };
      result?: {
        meetingId?: string;
        title?: string;
        estimatedUsageTokens?: number;
        finalDecision?: { decision?: string; summary?: string };
      };
    };
    if (!parsed.result?.meetingId || !parsed.result.title || !parsed.result.finalDecision) return null;
    return {
      id: parsed.result.meetingId,
      title: parsed.result.title,
      decision: parsed.result.finalDecision.decision ?? "",
      summary: parsed.result.finalDecision.summary ?? "",
      createdAt: parsed.metadata?.startedAt ?? "",
      tokens: parsed.result.estimatedUsageTokens ?? 0,
      filePath
    };
  } catch {
    return null;
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
