import type { PublicAppSettings, AppSettingsPatch } from "../app/settings.js";
import type { MeetingHistoryItem } from "../app/history.js";
import type { StartMeetingInput, StartMeetingOutput } from "../app/meeting-service.js";
import type { CouncilEvent } from "../types.js";

export interface ProviderTestResult {
  provider: "gemini" | "deepseek";
  ok: boolean;
  latencyMs: number;
  model: string;
  tokens: number;
}

export interface DesktopApi {
  getSettings(): Promise<PublicAppSettings>;
  saveSettings(patch: AppSettingsPatch): Promise<PublicAppSettings>;
  chooseMeetingDirectory(): Promise<string | null>;
  testProvider(provider: "gemini" | "deepseek"): Promise<ProviderTestResult>;
  startMeeting(input: StartMeetingInput): Promise<StartMeetingOutput>;
  listHistory(): Promise<MeetingHistoryItem[]>;
  showItemInFolder(filePath: string): Promise<void>;
  onMeetingEvent(listener: (event: CouncilEvent) => void): () => void;
}
