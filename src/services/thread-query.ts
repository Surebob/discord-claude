import Anthropic from '@anthropic-ai/sdk';
import { Message } from 'discord.js';
import { logger } from '@/utils/logger.js';
import { DELEGATE_CLAUDE_SETTINGS, TOKEN_MANAGEMENT } from '@/config/index.js';
import { buildContextWithSummaries } from './context-builder.js';

// Singleton Anthropic client for delegate queries to prevent connection pool exhaustion
let delegateClaudeClient: Anthropic | null = null;

// Rate limiting for delegate queries
const delegateQueryQueue: Array<() => Promise<any>> = [];
let activeQueries = 0;
const MAX_CONCURRENT_DELEGATE_QUERIES = 3; // Limit concurrent delegate queries

// Circuit breaker for API resilience
let circuitBreakerFailures = 0;
let circuitBreakerLastFailure = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before opening circuit
const CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute cooldown

function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    const timeSinceLastFailure = Date.now() - circuitBreakerLastFailure;
    if (timeSinceLastFailure < CIRCUIT_BREAKER_TIMEOUT) {
      return true; // Circuit is open
    } else {
      // Reset circuit breaker after timeout
      circuitBreakerFailures = 0;
      logger.info('🔄 Circuit breaker reset - attempting to resume delegate queries');
      return false;
    }
  }
  return false;
}

function recordCircuitBreakerSuccess(): void {
  if (circuitBreakerFailures > 0) {
    circuitBreakerFailures = Math.max(0, circuitBreakerFailures - 1);
  }
}

function recordCircuitBreakerFailure(): void {
  circuitBreakerFailures++;
  circuitBreakerLastFailure = Date.now();
  logger.warn(`⚠️ Circuit breaker failure recorded (${circuitBreakerFailures}/${CIRCUIT_BREAKER_THRESHOLD})`);
}

function getDelegateClaudeClient(): Anthropic {
  if (!delegateClaudeClient) {
    delegateClaudeClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!
    });
    logger.info('🔧 Initialized singleton delegate Claude client');
  }
  return delegateClaudeClient;
}

/**
 * Rate-limited execution of delegate queries
 */
async function executeWithRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const task = async () => {
      try {
        activeQueries++;
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        activeQueries--;
        // Process next in queue
        if (delegateQueryQueue.length > 0 && activeQueries < MAX_CONCURRENT_DELEGATE_QUERIES) {
          const nextTask = delegateQueryQueue.shift();
          if (nextTask) {
            nextTask();
          }
        }
      }
    };

    if (activeQueries < MAX_CONCURRENT_DELEGATE_QUERIES) {
      task();
    } else {
      delegateQueryQueue.push(task);
      logger.info(`⏳ Delegate query queued (${delegateQueryQueue.length} waiting)`);
    }
  });
}

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

export class ThreadQueryService {
  private discordClient: any;
  private attachmentProcessor?: (message: Message, existingAttachments: any[], messageLimit: number) => Promise<any[]>;

  constructor(discordClient: any, attachmentProcessor?: (message: Message, existingAttachments: any[], messageLimit: number) => Promise<any[]>) {
    this.discordClient = discordClient;
    this.attachmentProcessor = attachmentProcessor;
    // No longer creating individual Anthropic client instances
  }

  /**
   * Query thread context with focused natural language question
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
      if (isCircuitBreakerOpen()) {
        throw new Error('Delegate Claude service temporarily unavailable (circuit breaker open). Please try again later.');
      }

      // 1. Get thread channel from Discord
      const threadChannel = await this.getThreadChannel(threadId);
      
      logger.info(`✅ Found thread: ${threadChannel.name} (${threadChannel.id})`);

      // 2. Build FULL smart context for the thread
      logger.info('🧠 Building full smart context for delegate Claude...');
      
      let fullContext;
      try {
        fullContext = await buildContextWithSummaries(
          threadChannel,
          'adaptive', // Use adaptive strategy for optimal context
          undefined,  // No limit - let it decide
          undefined,  // No current message
          this.attachmentProcessor // Include attachment processing
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

      // 3. Build specialized prompt for delegate Claude
      const delegatePrompt = this.buildDelegatePrompt(sanitizedQuery, sanitizedContextHint, threadChannel.name);

      // 4. Create message history for delegate Claude (same format as main Claude)
      const delegateMessages = this.buildDelegateMessages(fullContext, delegatePrompt);

      // 5. Send to delegate Claude with specialized settings
      logger.info('🤖 Sending query to delegate Claude instance...');
      const response = await executeWithRateLimit(() => this.callDelegateClaudeWithRetry({
        model: DELEGATE_CLAUDE_SETTINGS.model,
        max_tokens: DELEGATE_CLAUDE_SETTINGS.maxTokens,
        temperature: DELEGATE_CLAUDE_SETTINGS.temperature,
        system: DELEGATE_CLAUDE_SETTINGS.systemPrompt,
        messages: delegateMessages
      }));

      logger.info(`✅ Delegate Claude responded with ${response.usage?.output_tokens || 'unknown'} tokens`);

      // Record circuit breaker success
      recordCircuitBreakerSuccess();

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
      const executionTime = Date.now() - startTime;
      
      // Record circuit breaker failure for API-related errors
      if (error instanceof Error && (
        error.message.includes('rate limit') ||
        error.message.includes('overloaded') ||
        error.message.includes('timeout') ||
        error.message.includes('502') ||
        error.message.includes('503') ||
        error.message.includes('504')
      )) {
        recordCircuitBreakerFailure();
      }
      
      logger.error(`❌ Thread query failed after ${executionTime}ms:`, error);
      throw new Error(`Failed to query thread context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Query multiple threads simultaneously for comprehensive answers
   */
  async queryMultipleThreads(
    queries: Array<{ threadId: string; query: string; contextHint?: string }>
  ): Promise<ThreadQueryResponse[]> {
    logger.info(`🔍 Starting multi-thread query: ${queries.length} threads`);
    
    try {
      // Execute all queries in parallel for efficiency
      const queryPromises = queries.map(({ threadId, query, contextHint }) =>
        this.queryThreadContext(threadId, query, contextHint)
      );

      const results = await Promise.all(queryPromises);
      
      logger.info(`✅ Completed multi-thread query: ${results.length} responses`);
      return results;

    } catch (error) {
      logger.error('❌ Error in multi-thread query:', error);
      throw new Error(`Failed to query multiple threads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get thread channel from Discord
   */
  private async getThreadChannel(threadId: string): Promise<any> {
    if (!this.discordClient) {
      throw new Error('Discord client not available');
    }

    const thread = await this.discordClient.channels.fetch(threadId);
    
    if (!thread) {
      throw new Error(`Thread with ID ${threadId} not found`);
    }

    if (!thread.isThread()) {
      throw new Error(`Channel ${threadId} is not a thread`);
    }

    return thread;
  }

  /**
   * Build specialized prompt for delegate Claude
   */
  private buildDelegatePrompt(query: string, contextHint?: string, threadName?: string): string {
    return `THREAD ANALYSIS REQUEST

**Thread:** ${threadName || 'Unknown'}
**Question:** "${query}"
${contextHint ? `**Context:** ${contextHint}` : ''}

Please analyze the complete thread conversation (summaries, messages, and documents) to answer this specific question. Focus on providing accurate, detailed information that directly addresses what was asked.`;
  }

  /**
   * Build message history for delegate Claude (same format as main Claude)
   */
  private buildDelegateMessages(
    context: {
      summaryContext: string;
      recentMessages: any[];
      contextDocuments: any[];
      totalTokenEstimate?: number;
      hasMoreHistory?: boolean;
      strategy?: string;
      tokenBreakdown?: any;
    },
    query: string
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    // Add context documents as first message if any exist
    if (context.contextDocuments && context.contextDocuments.length > 0) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Thread documents and attachments:'
          },
          ...context.contextDocuments
        ]
      });
      logger.info(`📎 Added ${context.contextDocuments.length} documents to delegate context`);
    }

    // Add summary context if available
    if (context.summaryContext) {
      messages.push({
        role: 'user',
        content: `Thread conversation summaries:\n\n${context.summaryContext}`
      });
      logger.info('📝 Added summary context to delegate');
    }

    // Add recent messages
    if (context.recentMessages && context.recentMessages.length > 0) {
      let messagesContent = 'Recent thread messages:\n\n';
      
      for (const msg of context.recentMessages) {
        if (!msg.content || msg.content.trim() === '') continue;
        
        let author = 'User';
        if (msg.author?.bot) {
          author = 'Claude';
        } else if (msg.author?.displayName) {
          author = msg.author.displayName;
        }
        
        messagesContent += `${author}: ${msg.content}\n\n`;
      }

      messages.push({
        role: 'user',
        content: messagesContent
      });
      logger.info(`💬 Added ${context.recentMessages.length} messages to delegate context`);
    }

    // Add the specific query
    messages.push({
      role: 'user',
      content: query
    });

    return messages;
  }

  /**
   * Call delegate Claude with retry logic
   */
  private async callDelegateClaudeWithRetry(params: any, maxRetries: number = 3): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🔄 Delegate Claude attempt ${attempt}/${maxRetries}`);
        
        const response = await getDelegateClaudeClient().messages.create(params);
        
        logger.info(`✅ Delegate Claude request successful on attempt ${attempt}`);
        return response;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`⚠️ Delegate Claude attempt ${attempt} failed:`, error);

        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        logger.info(`⏳ Retrying delegate Claude in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Delegate Claude failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }
}