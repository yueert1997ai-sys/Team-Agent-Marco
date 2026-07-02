export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
}

export interface SendChatInput {
  conversationId?: string;
  message: string;
}

export interface SendChatOutput {
  conversation: ChatConversation;
  assistantMessage: ChatMessage;
  consultedProviders: string[];
  usageTokens: number;
}

export type ChatEvent =
  | { type: "status"; status: "thinking" | "consulting" | "answering" | "saving"; text: string }
  | { type: "provider_completed"; provider: string }
  | { type: "completed"; conversationId: string };
