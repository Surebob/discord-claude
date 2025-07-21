import { logger } from './logger';

/**
 * Discord-specific logging utilities
 * Provides structured logging for Discord events and errors
 */
export const discordLogger = {
  /**
   * Log when the bot is mentioned by a user
   */
  mention: (userId: string, channelId: string, guildId?: string) => {
    logger.info(`👋 Bot mentioned by user`, {
      userId,
      channelId,
      guildId,
      type: 'MENTION'
    });
  },
  
  /**
   * Log Discord-related errors with proper context
   */
  error: (error: Error, context?: Record<string, unknown>) => {
    logger.error(`❌ Discord error: ${error.message}`, {
      error: error.stack,
      context,
      type: 'DISCORD_ERROR'
    });
  },

  /**
   * Log message processing events
   */
  messageProcessed: (messageId: string, userId: string, channelId: string, processingTimeMs: number) => {
    logger.info(`📝 Message processed`, {
      messageId,
      userId,
      channelId,
      processingTimeMs,
      type: 'MESSAGE_PROCESSED'
    });
  },

  /**
   * Log thread creation/management events
   */
  threadEvent: (threadId: string, event: string, context?: Record<string, unknown>) => {
    logger.info(`🧵 Thread ${event}`, {
      threadId,
      event,
      context,
      type: 'THREAD_EVENT'
    });
  }
}; 