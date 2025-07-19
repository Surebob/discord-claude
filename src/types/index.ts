export interface BotConfig {
  token: string;
  clientId: string;
  anthropicApiKey: string;
  botName: string;
  enableMentionResponses: boolean;
}

export interface ClaudeResponse {
  content: string;
}

// ConversationContext removed - we now read Discord history directly

export interface MessageHistory {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  userId?: string;
  messageId?: string;
}

export interface RateLimitInfo {
  remaining: number;
  resetTime: Date;
  isLimited: boolean;
} 