import type { ProviderId, ProviderUpdatePatch, PublicAppSettings, RuntimeSettingsPatch } from "../app/settings.js";
import type { ProviderDetectionResult } from "../app/provider-detection.js";
import type { ChatConversation, ChatConversationSummary, ChatEvent, SendChatInput, SendChatOutput } from "../chat/types.js";

export interface DetectedProviderSaveResult {
  detected: ProviderDetectionResult;
  settings: PublicAppSettings;
}

export interface DesktopApi {
  getSettings(): Promise<PublicAppSettings>;
  detectAndSaveApiKey(apiKey: string): Promise<DetectedProviderSaveResult>;
  removeProvider(provider: ProviderId): Promise<PublicAppSettings>;
  updateProvider(patch: ProviderUpdatePatch): Promise<PublicAppSettings>;
  updateRuntime(patch: RuntimeSettingsPatch): Promise<PublicAppSettings>;
  chooseConversationDirectory(): Promise<string | null>;
  sendChat(input: SendChatInput): Promise<SendChatOutput>;
  listConversations(): Promise<ChatConversationSummary[]>;
  getConversation(id: string): Promise<ChatConversation | null>;
  onChatEvent(listener: (event: ChatEvent) => void): () => void;
}
