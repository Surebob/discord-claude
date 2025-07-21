import { Client, Message, TextChannel, DMChannel, NewsChannel, ThreadChannel } from 'discord.js';

/**
 * Discord Module Types
 * Type definitions specific to Discord integration
 */

/**
 * AI Service Interface
 * Abstraction for AI processing services used by Discord handlers
 */
export interface AIService {
  healthCheck(): Promise<boolean>;
  
  // Legacy simple interface for backward compatibility
  processConversation(prompt: string, messageHistory: any[], attachments?: any[]): Promise<string>;
  
  // Enhanced interface for full smart context (with repository data)
  processWithSmartContext?(prompt: string, smartContext: {
    summaryContext: string;
    recentMessages: any[];
    contextDocuments: any[];
    totalTokenEstimate: number;
    hasMoreHistory: boolean;
    strategy: string;
    tokenBreakdown: {
      summaryTokens: number;
      messageTokens: number;
      documentTokens: number;
      systemTokens: number;
      availableForResponse: number;
    };
  }): Promise<string>;
}

/**
 * Supported Discord channel types for bot interactions
 */
export type SupportedChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

/**
 * Discord context information
 */
export interface DiscordContext {
  client: Client;
  channel: SupportedChannel;
  message?: Message;
  userId: string;
  guildId?: string;
  channelId: string;
}

/**
 * Message formatting options
 */
export interface MessageFormatOptions {
  maxLength?: number;
  preserveCodeBlocks?: boolean;
  addTypingIndicator?: boolean;
}

/**
 * Attachment processing result
 */
export interface AttachmentResult {
  type: 'text' | 'image' | 'document';
  content?: string;
  source?: unknown;
  filename: string;
  size: number;
}

/**
 * Rate limit status for Discord users
 */
export interface UserRateLimit {
  userId: string;
  isLimited: boolean;
  remaining: number;
  resetTime: Date;
}

/**
 * Discord client configuration
 */
export interface DiscordClientConfig {
  token: string;
  clientId: string;
  enableMentionResponses: boolean;
  botName: string;
}

/**
 * Message handling result
 */
export interface MessageHandlingResult {
  success: boolean;
  response?: string;
  error?: string;
  rateLimited?: boolean;
}

/**
 * Activity status for the Discord bot
 */
export interface BotActivity {
  name: string;
  type: 'PLAYING' | 'STREAMING' | 'LISTENING' | 'WATCHING' | 'CUSTOM';
  url?: string;
} 