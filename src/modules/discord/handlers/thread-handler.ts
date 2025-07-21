import { 
  Client, 
  ThreadChannel, 
  AuditLogEvent,
  Events
} from 'discord.js';
import { logger, discordLogger } from '../../infra/logging';
import { config } from '../../infra/config';
import { AIService } from '../types';

/**
 * Thread Handler
 * Processes Discord thread events and manages thread lifecycle
 */
export class ThreadHandler {
  private client: Client;
  private aiService?: AIService;

  constructor(client: Client, aiService?: AIService) {
    this.client = client;
    this.aiService = aiService;
    this.setupThreadEventHandlers();
  }

  /**
   * Set AI service for dependency injection
   */
  setAIService(aiService: AIService): void {
    this.aiService = aiService;
  }

  /**
   * Set up thread-specific event handlers
   */
  private setupThreadEventHandlers(): void {
    // Thread created event
    this.client.on(Events.ThreadCreate, async (thread) => {
      await this.handleThreadCreate(thread);
    });

    // Thread updated event (name change, archived, etc.)
    this.client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
      await this.handleThreadUpdate(oldThread, newThread);
    });

    // Thread deleted event
    this.client.on(Events.ThreadDelete, async (thread) => {
      await this.handleThreadDelete(thread);
    });

    // Member added to thread
    this.client.on(Events.ThreadMemberUpdate, async (oldMember, newMember) => {
      await this.handleThreadMemberUpdate(oldMember, newMember);
    });

    // Bot added to thread
    this.client.on(Events.ThreadMembersUpdate, async (addedMembers, removedMembers, thread) => {
      await this.handleThreadMembersUpdate(addedMembers, removedMembers, thread);
    });
  }

  /**
   * Handle thread creation
   */
  private async handleThreadCreate(thread: ThreadChannel): Promise<void> {
    try {
      discordLogger.threadEvent(thread.id, 'CREATED', {
        name: thread.name,
        parentId: thread.parentId,
        ownerId: thread.ownerId,
        type: thread.type
      });

      // Auto-join thread if bot should be there
      if (config.enableMentionResponses && thread.joinable) {
        await thread.join();
        logger.info(`🧵 Joined thread: ${thread.name} (${thread.id})`);
      }

      // Send welcome message if configured
      if (this.shouldSendWelcomeMessage(thread)) {
        await this.sendThreadWelcomeMessage(thread);
      }

    } catch (error) {
      logger.error('Error handling thread creation:', error);
    }
  }

  /**
   * Handle thread updates
   */
  private async handleThreadUpdate(oldThread: ThreadChannel, newThread: ThreadChannel): Promise<void> {
    try {
      const changes: Record<string, any> = {};
      
      if (oldThread.name !== newThread.name) {
        changes.nameChanged = { from: oldThread.name, to: newThread.name };
      }
      
      if (oldThread.archived !== newThread.archived) {
        changes.archivedChanged = { from: oldThread.archived, to: newThread.archived };
      }

      if (oldThread.locked !== newThread.locked) {
        changes.lockedChanged = { from: oldThread.locked, to: newThread.locked };
      }

      if (Object.keys(changes).length > 0) {
        discordLogger.threadEvent(newThread.id, 'UPDATED', changes);
      }

    } catch (error) {
      logger.error('Error handling thread update:', error);
    }
  }

  /**
   * Handle thread deletion
   */
  private async handleThreadDelete(thread: ThreadChannel): Promise<void> {
    try {
      discordLogger.threadEvent(thread.id, 'DELETED', {
        name: thread.name,
        parentId: thread.parentId,
        messageCount: thread.messageCount
      });

    } catch (error) {
      logger.error('Error handling thread deletion:', error);
    }
  }

  /**
   * Handle thread member updates
   */
  private async handleThreadMemberUpdate(oldMember: any, newMember: any): Promise<void> {
    try {
      // Log member permission changes or other updates
      if (oldMember && newMember) {
        discordLogger.threadEvent(newMember.id, 'MEMBER_UPDATED', {
          userId: newMember.userId,
          threadId: newMember.id
        });
      }

    } catch (error) {
      logger.error('Error handling thread member update:', error);
    }
  }

  /**
   * Handle thread members update (bulk add/remove)
   */
  private async handleThreadMembersUpdate(
    addedMembers: any, 
    removedMembers: any, 
    thread: ThreadChannel
  ): Promise<void> {
    try {
      // Convert collections to arrays for processing
      const addedArray = Array.from(addedMembers.values()) as any[];
      const removedArray = Array.from(removedMembers.values()) as any[];

      if (addedArray.length > 0) {
        discordLogger.threadEvent(thread.id, 'MEMBERS_ADDED', {
          count: addedArray.length,
          userIds: addedArray.map((m: any) => m.userId || m.user?.id)
        });

        // Check if bot was added
        const botAdded = addedArray.some((m: any) => (m.userId || m.user?.id) === this.client.user?.id);
        if (botAdded) {
          logger.info(`🤖 Bot added to thread: ${thread.name} (${thread.id})`);
          
          // Send introduction message
          if (this.shouldSendIntroMessage(thread)) {
            await this.sendThreadIntroMessage(thread);
          }
        }
      }

      if (removedArray.length > 0) {
        discordLogger.threadEvent(thread.id, 'MEMBERS_REMOVED', {
          count: removedArray.length,
          userIds: removedArray.map((m: any) => m.userId || m.user?.id)
        });
      }

    } catch (error) {
      logger.error('Error handling thread members update:', error);
    }
  }

  /**
   * Check if welcome message should be sent on thread creation
   */
  private shouldSendWelcomeMessage(thread: ThreadChannel): boolean {
    // Only send welcome if bot created the thread or is specifically configured
    return thread.ownerId === this.client.user?.id;
  }

  /**
   * Check if intro message should be sent when bot is added
   */
  private shouldSendIntroMessage(thread: ThreadChannel): boolean {
    // Send intro when bot is manually added to existing threads
    return thread.ownerId !== this.client.user?.id;
  }

  /**
   * Send welcome message to newly created thread
   */
  private async sendThreadWelcomeMessage(thread: ThreadChannel): Promise<void> {
    try {
      const welcomeMessage = `🧵 **Thread Created!**\n\nThis thread was created for focused discussion. I'm here to help!\n\n*You can mention me (@${this.client.user?.username}) or use /claude commands.*`;
      
      await thread.send(welcomeMessage);
      logger.info(`📩 Sent welcome message to thread: ${thread.name}`);

    } catch (error) {
      logger.error('Error sending thread welcome message:', error);
    }
  }

  /**
   * Send introduction message when bot is added to thread
   */
  private async sendThreadIntroMessage(thread: ThreadChannel): Promise<void> {
    try {
      const introMessage = `👋 **I've been added to this thread!**\n\nI can help with questions and discussions here. Feel free to mention me (@${this.client.user?.username}) or use /claude commands.\n\n*I'll have context of recent messages to better assist you.*`;
      
      await thread.send(introMessage);
      logger.info(`📩 Sent intro message to thread: ${thread.name}`);

    } catch (error) {
      logger.error('Error sending thread intro message:', error);
    }
  }

  /**
   * Create a new thread for a specific topic
   */
  async createTopicThread(
    channelId: string, 
    name: string, 
    message?: string,
    autoArchiveDuration?: number
  ): Promise<ThreadChannel | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      
      if (!channel || !channel.isTextBased() || !('threads' in channel)) {
        throw new Error('Channel does not support threads');
      }

      const thread = await channel.threads.create({
        name,
        autoArchiveDuration: autoArchiveDuration || 60, // 1 hour default
        reason: 'Thread created by Claude AI assistant'
      });

      if (message) {
        await thread.send(message);
      }

      discordLogger.threadEvent(thread.id, 'CREATED_BY_BOT', {
        name,
        parentId: channelId,
        hasInitialMessage: !!message
      });

      return thread;

    } catch (error) {
      logger.error('Error creating topic thread:', error);
      return null;
    }
  }

  /**
   * Archive a thread
   */
  async archiveThread(threadId: string, reason?: string): Promise<boolean> {
    try {
      const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
      
      if (!thread || !thread.isThread()) {
        throw new Error('Thread not found or invalid');
      }

      await thread.setArchived(true, reason);
      
      discordLogger.threadEvent(threadId, 'ARCHIVED', { reason });
      
      return true;

    } catch (error) {
      logger.error('Error archiving thread:', error);
      return false;
    }
  }

  /**
   * Get thread statistics
   */
  async getThreadStats(threadId: string): Promise<any> {
    try {
      const thread = await this.client.channels.fetch(threadId) as ThreadChannel;
      
      if (!thread || !thread.isThread()) {
        throw new Error('Thread not found or invalid');
      }

      return {
        id: thread.id,
        name: thread.name,
        memberCount: thread.memberCount,
        messageCount: thread.messageCount,
        archived: thread.archived,
        locked: thread.locked,
        createdAt: thread.createdAt,
        parentId: thread.parentId,
        ownerId: thread.ownerId
      };

    } catch (error) {
      logger.error('Error getting thread stats:', error);
      return null;
    }
  }
} 