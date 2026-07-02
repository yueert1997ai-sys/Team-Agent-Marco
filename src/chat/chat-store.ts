import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatConversation, ChatConversationSummary } from "./types.js";

export class ChatStore {
  constructor(private readonly directory: string) {}

  async get(id: string): Promise<ChatConversation | null> {
    try {
      return validateConversation(JSON.parse(await readFile(this.filePath(id), "utf8")));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async save(conversation: ChatConversation): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.filePath(conversation.id), `${JSON.stringify(conversation, null, 2)}\n`, "utf8");
  }

  async list(limit = 80): Promise<ChatConversationSummary[]> {
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const items = await Promise.all(files.map(async (entry) => {
      try {
        const conversation = validateConversation(JSON.parse(await readFile(path.join(this.directory, entry.name), "utf8")));
        const last = conversation.messages.at(-1)?.content ?? "";
        return {
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
          preview: last.replace(/\s+/g, " ").slice(0, 100)
        } satisfies ChatConversationSummary;
      } catch {
        return null;
      }
    }));
    return items
      .filter((item): item is ChatConversationSummary => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  private filePath(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation id.");
    return path.join(this.directory, `${id}.json`);
  }
}

function validateConversation(value: unknown): ChatConversation {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || !Array.isArray(value.messages)) {
    throw new Error("Invalid conversation file.");
  }
  return value as unknown as ChatConversation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
