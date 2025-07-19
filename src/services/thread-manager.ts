import { TextChannel, ThreadChannel, Message, ChannelType } from 'discord.js';
import { logger } from '@/utils/logger.js';

interface ThreadMetadata {
  threadId: string;
  channelId: string;
  threadName: string;
  purpose: string;
  createdBy: string;
  createdAt: Date;
  lastActivity: Date;
  handoffContext?: any[]; // Context from main conversation at thread creation
}

class ThreadManager {
  private threads: Map<string, ThreadMetadata> = new Map();
  private channelThreads: Map<string, string[]> = new Map(); // channelId -> threadIds[]
  private discordClient: any = null; // Will be set by Discord client

  /**
   * Create a new public thread in a channel
   */
  async createThread(
    channel: TextChannel,
    name: string,
    purpose: string,
    createdBy: string,
    startMessage?: Message
  ): Promise<ThreadChannel> {
    try {
      let thread: ThreadChannel;

      if (startMessage) {
        // Create thread from message
        thread = await startMessage.startThread({
          name: name,
          autoArchiveDuration: 1440, // 24 hours
          reason: `Thread created by Claude for: ${purpose}`
        });
      } else {
        // Create standalone thread
        thread = await channel.threads.create({
          name: name,
          autoArchiveDuration: 1440, // 24 hours
          type: ChannelType.PublicThread,
          reason: `Thread created by Claude for: ${purpose}`
        });
      }

      // Store thread metadata
      const metadata: ThreadMetadata = {
        threadId: thread.id,
        channelId: channel.id,
        threadName: name,
        purpose,
        createdBy,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      this.threads.set(thread.id, metadata);
      
      // Track threads per channel
      const channelThreadsList = this.channelThreads.get(channel.id) || [];
      channelThreadsList.push(thread.id);
      this.channelThreads.set(channel.id, channelThreadsList);

      logger.info(`📋 Created thread: ${name} (${thread.id}) in ${channel.name}`);
      
      return thread;
    } catch (error) {
      logger.error('Error creating thread:', error);
      throw new Error(`Failed to create thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Set handoff context from main conversation when thread is created
   */
  async setThreadHandoffContext(threadId: string, contextMessages: any[]): Promise<void> {
    const metadata = this.threads.get(threadId);
    if (metadata) {
      metadata.handoffContext = contextMessages;
      logger.info(`📋 Set handoff context for thread ${threadId}: ${contextMessages.length} messages`);
    }
  }

  /**
   * Get all messages from a thread for context, including handoff context
   */
  async getThreadContext(threadId: string): Promise<string[]> {
    try {
      const metadata = this.threads.get(threadId);
      if (!metadata) {
        throw new Error('Thread not found in metadata');
      }

      // Update last activity
      metadata.lastActivity = new Date();

      const thread = await this.getThreadById(threadId);
      if (!thread) {
        throw new Error('Thread not found on Discord');
      }

      const contextMessages: string[] = [];

      // **HANDOFF CONTEXT**: Add context from main conversation before thread creation
      if (metadata.handoffContext && metadata.handoffContext.length > 0) {
        contextMessages.push('--- Previous Conversation Context ---');
        for (const msg of metadata.handoffContext) {
          const roleLabel = msg.role === 'assistant' ? 'Claude' : 'User';
          contextMessages.push(`${roleLabel}: ${msg.content}`);
        }
        contextMessages.push('--- Thread Started Here ---');
      }

      // Get actual thread messages
      const messages = await thread.messages.fetch({ limit: 100 });

      // Sort messages by creation time (oldest first)
      const sortedMessages = Array.from(messages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      for (const message of sortedMessages) {
        if (message.author.bot && message.author.id === thread.client.user?.id) {
          // Claude's message
          contextMessages.push(`Claude: ${message.content}`);
        } else {
          // User message
          contextMessages.push(`${message.author.displayName}: ${message.content}`);
        }
      }

      return contextMessages;
    } catch (error) {
      logger.error('Error getting thread context:', error);
      throw new Error(`Failed to get thread context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get thread metadata by ID
   */
  getThreadMetadata(threadId: string): ThreadMetadata | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Get all threads for a channel
   */
  getChannelThreads(channelId: string): ThreadMetadata[] {
    const threadIds = this.channelThreads.get(channelId) || [];
    return threadIds
      .map(id => this.threads.get(id))
      .filter((metadata): metadata is ThreadMetadata => metadata !== undefined);
  }

  /**
   * Get active threads summary for system prompt
   */
  getActiveThreadsSummary(channelId: string): string {
    const threads = this.getChannelThreads(channelId);
    
    if (threads.length === 0) {
      return "No active threads in this channel.";
    }

    const threadList = threads
      .filter(thread => {
        // Consider thread active if last activity was within 24 hours
        const hoursSinceActivity = (Date.now() - thread.lastActivity.getTime()) / (1000 * 60 * 60);
        return hoursSinceActivity <= 24;
      })
      .map(thread => `- "${thread.threadName}" (${thread.purpose}) - created by ${thread.createdBy}`)
      .join('\n');

    return threadList || "No recently active threads.";
  }

  /**
   * Set Discord client reference for thread operations
   */
  setDiscordClient(client: any): void {
    this.discordClient = client;
  }

  /**
   * Helper to get thread by ID
   */
  private async getThreadById(threadId: string): Promise<ThreadChannel | null> {
    try {
      if (!this.discordClient) {
        logger.error('Discord client not available for thread retrieval');
        return null;
      }

      const metadata = this.threads.get(threadId);
      if (!metadata) return null;

      // Get the channel first, then the thread
      const channel = await this.discordClient.channels.fetch(metadata.channelId);
      if (!channel) return null;

      const thread = await channel.threads.fetch(threadId);
      return thread || null;
    } catch (error) {
      logger.error('Error getting thread by ID:', error);
      return null;
    }
  }

  /**
   * Remove thread from tracking (when archived/deleted)
   */
  removeThread(threadId: string): void {
    const metadata = this.threads.get(threadId);
    if (metadata) {
      // Remove from channel threads list
      const channelThreads = this.channelThreads.get(metadata.channelId) || [];
      const updatedChannelThreads = channelThreads.filter(id => id !== threadId);
      
      if (updatedChannelThreads.length === 0) {
        this.channelThreads.delete(metadata.channelId);
      } else {
        this.channelThreads.set(metadata.channelId, updatedChannelThreads);
      }

      // Remove from main threads map
      this.threads.delete(threadId);
      
      logger.info(`📋 Removed thread tracking: ${metadata.threadName} (${threadId})`);
    }
  }
}

export const threadManager = new ThreadManager(); 