import path from "node:path";
import { createConfiguredProviders } from "../providers/factory.js";
import { MultiProviderExecutor } from "../providers/multi-provider-executor.js";
import { runCouncilMeeting } from "../runner.js";
import { saveMeetingResult } from "../storage/meeting-store.js";
import type { CouncilEvent, CouncilMeetingResult } from "../types.js";
import type { RuntimeConfig } from "../config/runtime.js";
import { buildDemoTeam, type DemoMode } from "../demo/team.js";

export interface StartMeetingInput {
  title?: string;
  topic: string;
  context?: string;
  mode: "auto" | DemoMode;
}

export interface StartMeetingOutput {
  mode: DemoMode;
  providerIds: string[];
  result: CouncilMeetingResult;
  saved: { jsonPath: string; markdownPath: string };
}

export async function startMeeting(
  input: StartMeetingInput,
  runtime: RuntimeConfig,
  onEvent?: (event: CouncilEvent) => void
): Promise<StartMeetingOutput> {
  const topic = input.topic.trim();
  if (!topic) throw new Error("会议议题不能为空。");

  const hasLiveProvider = Boolean(runtime.geminiApiKey || runtime.deepSeekApiKey);
  const mode: DemoMode = input.mode === "auto" ? (hasLiveProvider ? "live" : "mock") : input.mode;
  const title = input.title?.trim() || makeTitle(topic);
  const team = buildDemoTeam(title, topic, input.context?.trim() ?? "", mode, runtime);
  const providers = createConfiguredProviders(runtime);
  const executor = new MultiProviderExecutor({
    providers,
    defaultProviderId: mode === "mock" ? "mock" : team.providerIds[0] ?? "mock"
  });
  const startedAt = new Date();
  const result = await runCouncilMeeting(team.config, executor, onEvent ? { onEvent } : {});
  const saved = await saveMeetingResult(result, runtime.meetingOutputDir, {
    mode,
    providers: team.providerIds,
    startedAt: startedAt.toISOString()
  });

  return { mode, providerIds: team.providerIds, result, saved };
}

function makeTitle(topic: string): string {
  const compact = topic.replace(/\s+/g, " ").trim();
  return compact.length <= 32 ? compact : `${compact.slice(0, 32)}…`;
}

export function defaultMeetingDirectory(documentsPath: string): string {
  return path.join(documentsPath, "Team Agent Marco", "meetings");
}
