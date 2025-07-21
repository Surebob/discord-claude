import { TextChannel, ThreadChannel, Message, ChannelType, Client } from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../infra/logging';
import { DELEGATE_CLAUDE_SETTINGS } from '../infra/config';
import { ContextService } from './context-service';

// Thread metadata interface
interface ThreadMetadata {
  threadId: string;
  channelId: string;
  threadName: string;
  purpose: string;
  createdBy: string;
  createdAt: Date;
  lastActivity: Date;
  handoffContext?: any[];
}

// Thread query response interface
interface ThreadQueryResponse {
  answer: string;
  threadName: string;
  threadId: string;
  sourceMessageCount: number;
  hasDocuments: boolean;
  tokenUsage: {
    input: number;
    output: number;
  };
}

/**
 * Circuit breaker state management for delegate queries
 */
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

/**
 * Delegate query queue item
 */
interface DelegateQuery {
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

/**
 * Unified Thread Service
 * Consolidates thread lifecycle management and intelligent querying
 */
export class ThreadService {
  private threads: Map<string, ThreadMetadata> = new Map();
  private channelThreads: Map<string, string[]> = new Map();
  private discordClient?: Client;
  
  // Instance-based delegate management (fixes memory leak)
  private delegateClaudeClient?: Anthropic;
  private delegateQueryQueue: Array<DelegateQuery> = [];
  private activeQueries = 0;
  private readonly MAX_CONCURRENT_DELEGATE_QUERIES = 3;
  
  // Instance-based circuit breaker (fixes memory leak)
  private circuitBreakerState: CircuitBreakerState = {
    failures: 0,
    lastFailure: 0,
    isOpen: false
  };
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000;
  
  // Cleanup timer to prevent memory leaks
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private contextService: ContextService) {
    // Start automatic cleanup every 30 minutes
    this.startCleanupTimer();
  }

  /**
   * Set Discord client for thread operations
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
    logger.info('🔧 Discord client set for thread service');
  }

  /**
   * Create a new public thread in a channel
   */
  async createThread(
    channel: TextChannel,
    name: string,
    purpose: string,
    createdBy: string,
    startMessage?: Message,
    handoffContext?: any[]
  ): Promise<ThreadChannel> {
    try {
      let thread: ThreadChannel;

      if (startMessage) {
        thread = await startMessage.startThread({
          name: name,
          autoArchiveDuration: 1440, // 24 hours
          reason: `Thread created by Claude for: ${purpose}`
        });
      } else {
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
        lastActivity: new Date(),
        handoffContext
      };

      this.threads.set(thread.id, metadata);

      // Track channel threads
      if (!this.channelThreads.has(channel.id)) {
        this.channelThreads.set(channel.id, []);
      }
      this.channelThreads.get(channel.id)!.push(thread.id);

      logger.info(`✅ Thread created: ${name} (${thread.id}) in channel ${channel.id}`);
      
      return thread;

    } catch (error) {
      logger.error('Error creating thread:', error);
      throw new Error(`Failed to create thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get thread by ID
   */
  async getThreadById(threadId: string): Promise<ThreadChannel | null> {
    if (!this.discordClient) {
      throw new Error('Discord client not initialized');
    }

    try {
      const channel = await this.discordClient.channels.fetch(threadId);
      return channel && channel.isThread() ? channel : null;
    } catch (error) {
      logger.error(`Error fetching thread ${threadId}:`, error);
      return null;
    }
  }

  /**
   * List all threads in a channel
   */
  async listThreads(channel: TextChannel, includeArchived: boolean = false): Promise<ThreadChannel[]> {
    try {
      const fetchOptions: any = {};
      if (includeArchived) {
        fetchOptions.archived = { before: new Date(), limit: 100 };
      }

      const fetchedThreads = await channel.threads.fetch(fetchOptions);
      
      if (!fetchedThreads) {
        return [];
      }

      // Handle the different return types from Discord.js
      const threadsCollection = 'threads' in fetchedThreads ? (fetchedThreads as any).threads : new Map();
      const threads = Array.from((threadsCollection as any).values()) as ThreadChannel[];
      
      // Update last activity for tracked threads
      threads.forEach((thread: ThreadChannel) => {
        const metadata = this.threads.get(thread.id);
        if (metadata) {
          metadata.lastActivity = new Date();
        }
      });

      return threads;

    } catch (error) {
      logger.error('Error listing threads:', error);
      throw new Error(`Failed to list threads: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

      // Add handoff context from main conversation before thread creation
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
   * Query thread context with focused natural language question using delegate Claude
   */
  async queryThreadContext(
    threadId: string, 
    query: string, 
    contextHint?: string
  ): Promise<ThreadQueryResponse> {
    const startTime = Date.now();
    
    try {
      // Input validation and sanitization
      if (!threadId || typeof threadId !== 'string') {
        throw new Error('Invalid threadId: must be a non-empty string');
      }
      
      if (!query || typeof query !== 'string') {
        throw new Error('Invalid query: must be a non-empty string');
      }
      
      // Prevent excessive token usage from malformed queries
      if (query.length > 2000) {
        throw new Error('Query too long: maximum 2000 characters allowed');
      }
      
      if (contextHint && contextHint.length > 500) {
        throw new Error('Context hint too long: maximum 500 characters allowed');
      }
      
      // Sanitize input to prevent potential issues
      const sanitizedQuery = query.trim().replace(/\0/g, '');
      const sanitizedContextHint = contextHint?.trim().replace(/\0/g, '');
      
      if (!sanitizedQuery) {
        throw new Error('Query cannot be empty after sanitization');
      }
      
      logger.info(`🔍 Thread query started: ${threadId} | Query: "${sanitizedQuery.substring(0, 100)}${sanitizedQuery.length > 100 ? '...' : ''}"`);

      // Check circuit breaker before proceeding
      if (this.isCircuitBreakerOpen()) {
        throw new Error('Delegate Claude service temporarily unavailable (circuit breaker open). Please try again later.');
      }

      // Get thread channel from Discord
      const threadChannel = await this.getThreadChannel(threadId);
      
      logger.info(`✅ Found thread: ${threadChannel.name} (${threadChannel.id})`);

      // Build FULL smart context for the thread using ContextService
      logger.info('🧠 Building full smart context for delegate Claude...');
      
      let fullContext;
      try {
        fullContext = await this.contextService.buildContextWithSummaries(
          threadChannel,
          'adaptive', // Use adaptive strategy for optimal context
          undefined,  // No limit - let it decide
          undefined,  // No current message
          undefined   // No attachment processor for thread queries
        );
      } catch (error) {
        logger.error('❌ Failed to build smart context, falling back to basic message fetch', error);
        
        // Fallback: Get basic messages without smart context
        const messages = await threadChannel.messages.fetch({ limit: 50 });
        const messageArray = Array.from(messages.values()).reverse();
        
        fullContext = {
          summaryContext: '',
          recentMessages: messageArray,
          contextDocuments: [],
          totalTokenEstimate: messageArray.length * 100, // Rough estimate
          hasMoreHistory: messages.size === 50,
          strategy: 'fallback',
          tokenBreakdown: {
            summaryTokens: 0,
            messageTokens: messageArray.length * 100,
            documentTokens: 0,
            systemTokens: 1000,
            availableForResponse: 150000
          }
        };
        
        logger.info('✅ Using fallback context for delegate Claude');
      }

      logger.info(`📊 Delegate context: ${fullContext.strategy} strategy, ${fullContext.recentMessages.length} messages, ${fullContext.contextDocuments.length} documents`);
      logger.info(`🔢 Total context tokens: ${fullContext.totalTokenEstimate}`);

      // Build specialized prompt for delegate Claude
      const delegatePrompt = this.buildDelegatePrompt(sanitizedQuery, sanitizedContextHint, threadChannel.name);

      // Create message history for delegate Claude
      const delegateMessages = this.buildDelegateMessages(fullContext, delegatePrompt);

      // Send to delegate Claude with specialized settings
      logger.info('🤖 Sending query to delegate Claude instance...');
      const response = await this.callDelegateClaudeWithRetry({
        model: DELEGATE_CLAUDE_SETTINGS.model,
        max_tokens: DELEGATE_CLAUDE_SETTINGS.maxTokens,
        temperature: DELEGATE_CLAUDE_SETTINGS.temperature,
        system: DELEGATE_CLAUDE_SETTINGS.systemPrompt,
        messages: delegateMessages
      });

      logger.info(`✅ Delegate Claude responded with ${response.usage?.output_tokens || 'unknown'} tokens`);

      // Record circuit breaker success
      this.recordCircuitBreakerSuccess();

      // Calculate performance metrics
      const executionTime = Date.now() - startTime;
      const tokenEfficiency = response.usage ? 
        (response.usage.output_tokens / response.usage.input_tokens).toFixed(2) : 'unknown';
      
      logger.info(`📊 Query metrics - Time: ${executionTime}ms | Input tokens: ${response.usage?.input_tokens || 0} | Output tokens: ${response.usage?.output_tokens || 0} | Efficiency: ${tokenEfficiency}`);

      return {
        answer: response.content[0].type === 'text' ? response.content[0].text : 'No text response',
        threadName: threadChannel.name,
        threadId: threadChannel.id,
        sourceMessageCount: fullContext.recentMessages.length,
        hasDocuments: fullContext.contextDocuments.length > 0,
        tokenUsage: {
          input: response.usage?.input_tokens || 0,
          output: response.usage?.output_tokens || 0
        }
      };

    } catch (error) {
      this.recordCircuitBreakerFailure();
      logger.error('Error in queryThreadContext:', error);
      throw new Error(`Failed to query thread context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Archive a thread
   */
  async archiveThread(threadId: string, reason?: string): Promise<void> {
    try {
      const thread = await this.getThreadById(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }

      await thread.setArchived(true, reason);
      
      // Update metadata
      const metadata = this.threads.get(threadId);
      if (metadata) {
        metadata.lastActivity = new Date();
      }

      logger.info(`📦 Thread archived: ${threadId}`);

    } catch (error) {
      logger.error('Error archiving thread:', error);
      throw new Error(`Failed to archive thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get thread metadata
   */
  getThreadMetadata(threadId: string): ThreadMetadata | undefined {
    return this.threads.get(threadId);
  }

  /**
   * Get threads by channel
   */
  getThreadsByChannel(channelId: string): string[] {
    return this.channelThreads.get(channelId) || [];
  }

  /**
   * Clear old thread metadata (cleanup)
   */
  clearOldThreads(olderThanDays: number = 30): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let cleared = 0;
    for (const [threadId, metadata] of this.threads.entries()) {
      if (metadata.lastActivity < cutoffDate) {
        this.threads.delete(threadId);
        
        // Remove from channel threads
        const channelThreads = this.channelThreads.get(metadata.channelId);
        if (channelThreads) {
          const index = channelThreads.indexOf(threadId);
          if (index > -1) {
            channelThreads.splice(index, 1);
          }
        }
        
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.info(`🧹 Cleared ${cleared} old thread metadata entries`);
    }
  }

  /**
   * Start automatic cleanup timer (fixes memory leak)
   */
  private startCleanupTimer(): void {
    // Clear any existing timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    // Run cleanup every 30 minutes
    this.cleanupTimer = setInterval(() => {
      this.clearOldThreads(30); // Clear threads older than 30 days
      this.cleanupDelegateQueue(); // Clear stale queue items
    }, 30 * 60 * 1000);
    
    logger.info('🔄 Automatic cleanup timer started (30 minute intervals)');
  }

  /**
   * Clean up stale delegate query queue items
   */
  private cleanupDelegateQueue(): void {
    const initialSize = this.delegateQueryQueue.length;
    // Note: In a real implementation, you'd want to track query timestamps
    // and clean up queries that have been pending too long
    if (initialSize > 100) {
      logger.warn(`⚠️ Delegate query queue is large (${initialSize} items) - consider investigating`);
    }
  }

  /**
   * Circuit breaker state management (instance-based)
   */
  private isCircuitBreakerOpen(): boolean {
    if (this.circuitBreakerState.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      const timeSinceLastFailure = Date.now() - this.circuitBreakerState.lastFailure;
      if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
        this.circuitBreakerState.isOpen = true;
        return true;
      } else {
        this.circuitBreakerState.failures = 0;
        this.circuitBreakerState.isOpen = false;
        logger.info('🔄 Circuit breaker reset - attempting to resume delegate queries');
        return false;
      }
    }
    return false;
  }

  /**
   * Record circuit breaker success (instance-based)
   */
  private recordCircuitBreakerSuccess(): void {
    if (this.circuitBreakerState.failures > 0) {
      this.circuitBreakerState.failures = 0;
      this.circuitBreakerState.isOpen = false;
      logger.info('✅ Circuit breaker success recorded - failures reset');
    }
  }

  /**
   * Record circuit breaker failure (instance-based)
   */
  private recordCircuitBreakerFailure(): void {
    this.circuitBreakerState.failures++;
    this.circuitBreakerState.lastFailure = Date.now();
    this.circuitBreakerState.isOpen = true;
    logger.error(`❌ Circuit breaker failure recorded (${this.circuitBreakerState.failures}/${this.CIRCUIT_BREAKER_THRESHOLD})`);
  }

  /**
   * Get thread channel by ID
   */
  private async getThreadChannel(threadId: string): Promise<any> {
    if (!this.discordClient) {
      throw new Error('Discord client not available in thread context');
    }

    try {
      const channel = await this.discordClient.channels.fetch(threadId);
      if (!channel || !channel.isThread()) {
        throw new Error(`Thread ${threadId} not found or is not a thread`);
      }
      return channel;
    } catch (error) {
      throw new Error(`Failed to fetch thread ${threadId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build specialized prompt for delegate Claude
   */
  private buildDelegatePrompt(query: string, contextHint?: string, threadName?: string): string {
    let prompt = `You are a specialized Claude instance analyzing this Discord thread to answer a specific question.\n\n`;
    
    if (threadName) {
      prompt += `**Thread:** ${threadName}\n`;
    }
    
    prompt += `**Question:** "${query}"\n`;
    
    if (contextHint) {
      prompt += `**Context:** ${contextHint}\n`;
    }
    
    prompt += `\nPlease provide a focused answer based on the thread content. Be specific and cite relevant information from the messages. If the thread doesn't contain enough information to answer the question, say so clearly.`;
    
    return prompt;
  }

  /**
   * Build message history for delegate Claude
   */
  private buildDelegateMessages(fullContext: any, delegatePrompt: string): any[] {
    const messages = [];

    // Add context documents if any
    if (fullContext.contextDocuments && fullContext.contextDocuments.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Context documents from thread:' },
          ...fullContext.contextDocuments
        ]
      });
    }

    // Add recent messages from thread
    for (const msg of fullContext.recentMessages) {
      if (!msg.content || msg.content.trim() === '') continue;
      
      let role: 'user' | 'assistant' = 'user';
      let content = msg.content;
      
      if (msg.author?.bot && msg.author?.id === this.discordClient?.user?.id) {
        role = 'assistant';
      } else {
        if (msg.guild && msg.author?.displayName) {
          content = `${msg.author.displayName}: ${content}`;
        }
      }
      
      messages.push({ role, content });
    }

    // Add the delegate query prompt
    messages.push({
      role: 'user',
      content: delegatePrompt
    });

    return messages;
  }

  /**
   * Call delegate Claude with retry logic
   */
  private async callDelegateClaudeWithRetry(params: any, maxRetries: number = 3): Promise<any> {
    // Check circuit breaker before attempting
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Circuit breaker is open - delegate queries temporarily disabled');
    }

    // Initialize delegate client if needed (secure initialization)
    if (!this.delegateClaudeClient) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required');
      }
      
      this.delegateClaudeClient = new Anthropic({
        apiKey: apiKey
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.delegateClaudeClient.messages.create(params);
        this.recordCircuitBreakerSuccess();
        return response;
      } catch (error) {
        lastError = error as Error;
        
        // Record failure for circuit breaker
        this.recordCircuitBreakerFailure();
        
        if (attempt === maxRetries) break;
        
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Clean up resources when service is destroyed
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    // Clean up any pending delegate queries
    this.delegateQueryQueue.forEach(query => {
      query.reject(new Error('ThreadService destroyed'));
    });
    this.delegateQueryQueue.length = 0;
    
    logger.info('🧹 ThreadService destroyed and cleaned up');
  }
} 