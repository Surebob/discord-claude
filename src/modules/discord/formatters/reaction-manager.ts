import { Message, MessageReaction, User, Client } from 'discord.js';
import { logger } from '../../infra/logging';

/**
 * Reaction Manager
 * Handles Discord reaction feedback and interactive responses
 */
export class ReactionManager {
  private client: Client;
  private reactionHandlers: Map<string, (reaction: MessageReaction, user: User) => Promise<void>>;
  private temporaryReactions: Map<string, NodeJS.Timeout>;
  private cleanupTimer?: NodeJS.Timeout;

  // Standard reaction emojis
  static readonly REACTIONS = {
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    LOADING: '⏳',
    THINKING: '🤔',
    THUMBS_UP: '👍',
    THUMBS_DOWN: '👎',
    HEART: '❤️',
    FIRE: '🔥',
    EYES: '👀',
    CHECK: '✔️',
    CROSS: '❌',
    QUESTION: '❓',
    EXCLAMATION: '❗',
    INFO: 'ℹ️'
  } as const;

  constructor(client: Client) {
    this.client = client;
    this.reactionHandlers = new Map();
    this.temporaryReactions = new Map();
    
    // Start automatic cleanup to prevent memory leaks
    this.startCleanupTimer();
  }

  /**
   * Set up reaction event handlers
   */
  private setupReactionEventHandlers(): void {
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      
      // Fetch full reaction if partial
      if (reaction.partial) {
        try {
          reaction = await reaction.fetch();
        } catch (error) {
          logger.error('Error fetching partial reaction:', error);
          return;
        }
      }

      // Fetch full user if partial
      if (user.partial) {
        try {
          user = await user.fetch();
        } catch (error) {
          logger.error('Error fetching partial user:', error);
          return;
        }
      }
      
      await this.handleReactionAdd(reaction, user);
    });

    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      
      // Fetch full reaction if partial
      if (reaction.partial) {
        try {
          reaction = await reaction.fetch();
        } catch (error) {
          logger.error('Error fetching partial reaction:', error);
          return;
        }
      }

      // Fetch full user if partial
      if (user.partial) {
        try {
          user = await user.fetch();
        } catch (error) {
          logger.error('Error fetching partial user:', error);
          return;
        }
      }
      
      await this.handleReactionRemove(reaction, user);
    });
  }

  /**
   * Handle reaction added to message
   */
  private async handleReactionAdd(reaction: MessageReaction, user: User): Promise<void> {
    try {
      const messageId = reaction.message.id;
      const emoji = reaction.emoji.name || reaction.emoji.toString();
      const handlerKey = `${messageId}:${emoji}`;

      const handler = this.reactionHandlers.get(handlerKey);
      if (handler) {
        await handler(reaction, user);
      }

    } catch (error) {
      logger.error('Error handling reaction add:', error);
    }
  }

  /**
   * Handle reaction removed from message
   */
  private async handleReactionRemove(reaction: MessageReaction, user: User): Promise<void> {
    try {
      // Handle reaction removal if needed
      logger.debug(`Reaction ${reaction.emoji.name} removed by ${user.tag}`);
    } catch (error) {
      logger.error('Error handling reaction remove:', error);
    }
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(message: Message, emoji: string): Promise<boolean> {
    try {
      await message.react(emoji);
      return true;
    } catch (error) {
      logger.error(`Failed to add reaction ${emoji}:`, error);
      return false;
    }
  }

  /**
   * Add multiple reactions to a message
   */
  async addReactions(message: Message, emojis: string[]): Promise<void> {
    for (const emoji of emojis) {
      try {
        await message.react(emoji);
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (error) {
        logger.error(`Failed to add reaction ${emoji}:`, error);
      }
    }
  }

  /**
   * Add a temporary reaction that gets removed after a delay
   */
  async addTemporaryReaction(
    message: Message, 
    emoji: string, 
    duration: number = 5000
  ): Promise<void> {
    try {
      await message.react(emoji);
      
      const timeout = setTimeout(async () => {
        try {
          const reaction = message.reactions.cache.get(emoji);
          if (reaction) {
            await reaction.users.remove(this.client.user!.id);
          }
          this.temporaryReactions.delete(message.id);
        } catch (error) {
          logger.error('Error removing temporary reaction:', error);
        }
      }, duration);

      this.temporaryReactions.set(message.id, timeout);

    } catch (error) {
      logger.error('Error adding temporary reaction:', error);
    }
  }

  /**
   * Add status reactions for AI processing
   */
  async addProcessingReactions(message: Message): Promise<void> {
    await this.addReactions(message, [
      ReactionManager.REACTIONS.LOADING,
      ReactionManager.REACTIONS.THINKING
    ]);
  }

  /**
   * Add success reaction
   */
  async addSuccessReaction(message: Message): Promise<void> {
    await this.addReaction(message, ReactionManager.REACTIONS.SUCCESS);
  }

  /**
   * Add error reaction
   */
  async addErrorReaction(message: Message): Promise<void> {
    await this.addReaction(message, ReactionManager.REACTIONS.ERROR);
  }

  /**
   * Add feedback reactions (thumbs up/down)
   */
  async addFeedbackReactions(message: Message): Promise<void> {
    await this.addReactions(message, [
      ReactionManager.REACTIONS.THUMBS_UP,
      ReactionManager.REACTIONS.THUMBS_DOWN
    ]);
  }

  /**
   * Replace loading reaction with result
   */
  async replaceLoadingReaction(
    message: Message, 
    success: boolean
  ): Promise<void> {
    try {
      // Remove loading reactions
      const loadingReaction = message.reactions.cache.get(ReactionManager.REACTIONS.LOADING);
      if (loadingReaction) {
        await loadingReaction.users.remove(this.client.user!.id);
      }

      const thinkingReaction = message.reactions.cache.get(ReactionManager.REACTIONS.THINKING);
      if (thinkingReaction) {
        await thinkingReaction.users.remove(this.client.user!.id);
      }

      // Add result reaction
      const resultEmoji = success ? ReactionManager.REACTIONS.SUCCESS : ReactionManager.REACTIONS.ERROR;
      await this.addReaction(message, resultEmoji);

    } catch (error) {
      logger.error('Error replacing loading reaction:', error);
    }
  }

  /**
   * Register a reaction handler for a specific message and emoji
   */
  registerReactionHandler(
    messageId: string,
    emoji: string,
    handler: (reaction: MessageReaction, user: User) => Promise<void>,
    timeout?: number
  ): void {
    const handlerKey = `${messageId}:${emoji}`;
    this.reactionHandlers.set(handlerKey, handler);

    // Auto-remove handler after timeout
    if (timeout) {
      setTimeout(() => {
        this.reactionHandlers.delete(handlerKey);
      }, timeout);
    }
  }

  /**
   * Create an interactive confirmation with reactions
   */
  async createConfirmation(
    message: Message,
    onConfirm: () => Promise<void>,
    onCancel?: () => Promise<void>,
    timeout: number = 30000
  ): Promise<void> {
    await this.addReactions(message, [
      ReactionManager.REACTIONS.CHECK,
      ReactionManager.REACTIONS.CROSS
    ]);

    // Register handlers
    this.registerReactionHandler(
      message.id,
      ReactionManager.REACTIONS.CHECK,
      async (reaction, user) => {
        await onConfirm();
        await this.clearReactions(message);
      },
      timeout
    );

    this.registerReactionHandler(
      message.id,
      ReactionManager.REACTIONS.CROSS,
      async (reaction, user) => {
        if (onCancel) await onCancel();
        await this.clearReactions(message);
      },
      timeout
    );

    // Auto-cleanup after timeout
    setTimeout(async () => {
      await this.clearReactions(message);
      this.removeReactionHandlers(message.id);
    }, timeout);
  }

  /**
   * Create a feedback collection system
   */
  async createFeedbackCollection(
    message: Message,
    onPositive?: (user: User) => Promise<void>,
    onNegative?: (user: User) => Promise<void>,
    timeout: number = 300000 // 5 minutes
  ): Promise<void> {
    await this.addFeedbackReactions(message);

    if (onPositive) {
      this.registerReactionHandler(
        message.id,
        ReactionManager.REACTIONS.THUMBS_UP,
        async (reaction, user) => await onPositive(user),
        timeout
      );
    }

    if (onNegative) {
      this.registerReactionHandler(
        message.id,
        ReactionManager.REACTIONS.THUMBS_DOWN,
        async (reaction, user) => await onNegative(user),
        timeout
      );
    }

    // Auto-cleanup
    setTimeout(() => {
      this.removeReactionHandlers(message.id);
    }, timeout);
  }

  /**
   * Clear all reactions from a message
   */
  async clearReactions(message: Message): Promise<void> {
    try {
      await message.reactions.removeAll();
    } catch (error) {
      logger.error('Error clearing reactions:', error);
    }
  }

  /**
   * Remove specific reaction from message
   */
  async removeReaction(message: Message, emoji: string): Promise<void> {
    try {
      const reaction = message.reactions.cache.get(emoji);
      if (reaction) {
        await reaction.users.remove(this.client.user!.id);
      }
    } catch (error) {
      logger.error(`Error removing reaction ${emoji}:`, error);
    }
  }

  /**
   * Remove all reaction handlers for a message
   */
  removeReactionHandlers(messageId: string): void {
    const keysToRemove = Array.from(this.reactionHandlers.keys())
      .filter(key => key.startsWith(`${messageId}:`));
    
    keysToRemove.forEach(key => {
      this.reactionHandlers.delete(key);
    });
  }

  /**
   * Clean up temporary reactions and handlers
   */
  cleanup(): void {
    // Clear all temporary reaction timeouts
    for (const timeout of this.temporaryReactions.values()) {
      clearTimeout(timeout);
    }
    this.temporaryReactions.clear();

    // Clear all handlers
    this.reactionHandlers.clear();
    
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Start automatic cleanup timer to prevent memory leaks
   */
  private startCleanupTimer(): void {
    // Run cleanup every 10 minutes to prevent memory accumulation
    this.cleanupTimer = setInterval(() => {
      this.performPeriodicCleanup();
    }, 10 * 60 * 1000);
    
    logger.info('🔄 ReactionManager automatic cleanup timer started');
  }

  /**
   * Perform periodic cleanup of stale data
   */
  private performPeriodicCleanup(): void {
    const initialHandlers = this.reactionHandlers.size;
    const initialReactions = this.temporaryReactions.size;
    
    // Clean up any expired temporary reactions (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    // Note: In a full implementation, we'd track creation timestamps
    // For now, we'll just warn if the maps are getting too large
    if (initialHandlers > 1000) {
      logger.warn(`⚠️ ReactionManager has ${initialHandlers} handlers - consider investigating for memory leaks`);
    }
    
    if (initialReactions > 100) {
      logger.warn(`⚠️ ReactionManager has ${initialReactions} temporary reactions - consider investigating for memory leaks`);
    }
  }

  /**
   * Get reaction statistics for a message
   */
  getReactionStats(message: Message): Array<{emoji: string, count: number, users: string[]}> {
    return message.reactions.cache.map(reaction => ({
      emoji: reaction.emoji.name || reaction.emoji.toString(),
      count: reaction.count,
      users: reaction.users.cache.map(user => user.tag)
    }));
  }

  /**
   * Check if user has reacted with specific emoji
   */
  async hasUserReacted(message: Message, userId: string, emoji: string): Promise<boolean> {
    try {
      const reaction = message.reactions.cache.get(emoji);
      if (!reaction) return false;
      
      const users = await reaction.users.fetch();
      return users.has(userId);
    } catch (error) {
      logger.error('Error checking user reaction:', error);
      return false;
    }
  }
} 