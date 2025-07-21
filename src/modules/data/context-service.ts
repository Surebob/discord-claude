import Anthropic from '@anthropic-ai/sdk';
import { Message, TextChannel, DMChannel, PartialDMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger } from '../infra/logging';
import { CLAUDE_SETTINGS, TOKEN_MANAGEMENT, CONTEXT_MANAGEMENT } from '../infra/config';
import { SummaryRepository } from './repositories/summary-repository';
import { type ConversationSummary } from './types';

/**
 * Context Service
 * Comprehensive context building with repository-based summaries, strategies, and attachment processing
 */
export class ContextService {
  private anthropic: Anthropic;

  constructor(private summaryRepository: SummaryRepository, apiKey?: string) {
    const claudeApiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      throw new Error('ANTHROPIC_API_KEY must be provided either as parameter or environment variable');
    }
    
    this.anthropic = new Anthropic({
      apiKey: claudeApiKey
    });
  }

  /**
   * Get messages for context using adaptive strategy
   */
  async getMessagesForContext(
    channel: TextChannel | DMChannel | PartialDMChannel | NewsChannel | ThreadChannel,
    strategy: 'fixed' | 'adaptive' | 'unlimited' = CONTEXT_MANAGEMENT.STRATEGY,
    requestedLimit?: number
  ): Promise<{ messages: Message[], hasMoreHistory: boolean, strategy: string }> {
    try {
      // Get the latest summary to determine where to start fetching
      const latestSummary = await this.summaryRepository.findLatestByChannelId(channel.id);
      
      let afterMessageId: string | undefined;
      if (latestSummary) {
        afterMessageId = latestSummary.last_message_id;
        logger.info(`📝 Found summary boundary at message ${afterMessageId}`);
      } else {
        logger.info(`📝 No existing summaries for channel ${channel.id}`);
      }
      
      // Determine fetch limit based on strategy
      let fetchLimit: number;
      let actualStrategy = strategy;
      
      switch (strategy) {
        case 'fixed':
          fetchLimit = requestedLimit || CONTEXT_MANAGEMENT.FIXED_MESSAGE_LIMIT;
          break;
          
        case 'adaptive':
          // Start with base limit and adapt based on token usage
          fetchLimit = Math.min(
            requestedLimit || CONTEXT_MANAGEMENT.ADAPTIVE_INITIAL_LIMIT,
            CONTEXT_MANAGEMENT.ADAPTIVE_MAX_LIMIT
          );
          break;
          
        case 'unlimited':
          fetchLimit = 100; // Discord API max per fetch
          break;
          
        default:
          fetchLimit = CONTEXT_MANAGEMENT.FIXED_MESSAGE_LIMIT;
          actualStrategy = 'fixed';
      }

      logger.info(`📊 Using ${actualStrategy} strategy with limit ${fetchLimit} (after message: ${afterMessageId || 'none'})`);

      // Fetch messages with proper pagination
      const fetchOptions: any = { limit: fetchLimit };
      if (afterMessageId) {
        fetchOptions.after = afterMessageId;
      }

      const fetchedMessages = await channel.messages.fetch(fetchOptions) as any;
      const messages = Array.from(fetchedMessages.values()).reverse() as Message[]; // Oldest first

      // For adaptive strategy, check if we need to adjust
      if (strategy === 'adaptive' && messages.length > 0) {
        const estimatedTokens = this.estimateTokenCount(messages);
        
        // Use 70% of context window as soft limit
        const softLimit = Math.floor(TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE * 0.7);
        if (estimatedTokens > softLimit) {
          // Reduce messages to fit within token limits
          const targetMessageCount = Math.floor(messages.length * (softLimit / estimatedTokens));
          const reducedMessages = messages.slice(-targetMessageCount);
          
          logger.info(`🔧 Adaptive strategy: reduced from ${messages.length} to ${reducedMessages.length} messages for token efficiency`);
          
          return {
            messages: reducedMessages,
            hasMoreHistory: true,
            strategy: `${actualStrategy} (token-optimized)`
          };
        }
      }

      const hasMoreHistory = strategy === 'unlimited' ? 
        fetchedMessages.size === fetchLimit : 
        fetchedMessages.size === fetchLimit || afterMessageId !== undefined;

      logger.info(`✅ Fetched ${messages.length} messages using ${actualStrategy} strategy (hasMore: ${hasMoreHistory})`);

      return {
        messages,
        hasMoreHistory,
        strategy: actualStrategy
      };

    } catch (error) {
      logger.error('Error fetching messages for context:', error);
      throw new Error(`Failed to get messages for context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build complete context including summaries and recent messages
   */
  async buildContextWithSummaries(
    channel: TextChannel | DMChannel | PartialDMChannel | NewsChannel | ThreadChannel,
    strategy: 'fixed' | 'adaptive' | 'unlimited' = CONTEXT_MANAGEMENT.STRATEGY,
    requestedLimit?: number,
    currentMessage?: Message,
    attachmentProcessor?: (message: Message, existingAttachments: any[], messageLimit: number) => Promise<any[]>
  ): Promise<{ 
    summaryContext: string;
    recentMessages: Message[];
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
  }> {
    try {
      // Get all summaries for this channel
      const summaries = await this.summaryRepository.findByChannelId(channel.id);
      
      // Get recent messages after the last summary using selected strategy
      const { messages: recentMessages, hasMoreHistory, strategy: actualStrategy } = await this.getMessagesForContext(
        channel, 
        strategy,
        requestedLimit
      );
      
      // Process deduplicated documents from context if processor provided
      let contextDocuments: any[] = [];
      if (currentMessage && attachmentProcessor) {
        logger.info('🔍 Processing context documents with deduplication...');
        contextDocuments = await attachmentProcessor(currentMessage, [], recentMessages.length + 1);
        logger.info(`📎 Found ${contextDocuments.length} unique document(s) in context`);
      }
      
      // Build summary context string
      let summaryContext = '';
      if (summaries.length > 0) {
        summaryContext = '## Previous Conversation Summaries:\n\n';
        
        summaries.forEach((summary: ConversationSummary) => {
          summaryContext += `### Context Window ${summary.context_window_number}:\n`;
          summaryContext += `${summary.summary}\n\n`;
          
          // Add file information if any
          if (summary.files_mentioned && summary.files_mentioned.length > 0) {
            summaryContext += `**Files mentioned in this window:**\n`;
            summary.files_mentioned.forEach((file: any) => {
              summaryContext += `- ${file.name} (${file.type}): ${file.description}\n`;
            });
            summaryContext += '\n';
          }
        });
        
        summaryContext += '---\n\n';
      }
      
      // Use ACCURATE token counting by sending exact payload to Anthropic API
      let accurateTokenCount = 0;
      let tokenBreakdown = {
        summaryTokens: 0,
        messageTokens: 0,
        documentTokens: 0,
        systemTokens: 0, // Will be calculated
        availableForResponse: 0
      };
      
      try {
        // Build the EXACT same messages that will be sent to Claude
        const testMessages = [];
        
        // Convert recent messages to exact format
        for (const msg of recentMessages) {
          if (!msg.content || msg.content.trim() === '') continue;
          
          let role: 'user' | 'assistant' = 'user';
          let content = msg.content;
          
          // Same logic as buildMessageHistoryFromSmartContext
          if (msg.author?.bot) {
            role = 'assistant';
          } else {
            if (msg.guild && msg.author?.displayName) {
              content = `${msg.author.displayName}: ${content}`;
            }
          }
          
          testMessages.push({
            role,
            content
          });
        }
        
        // Add context documents as a separate message at the beginning (if any)
        if (contextDocuments.length > 0) {
          testMessages.unshift({
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Context documents from conversation history:'
              },
              ...contextDocuments
            ]
          });
        }
        
        // Build system prompt with summary context (same as generateResponse)
        let systemPrompt: string = CLAUDE_SETTINGS.systemPrompt;
        if (summaryContext) {
          systemPrompt = `${summaryContext}\n\n${CLAUDE_SETTINGS.systemPrompt}\n\n**IMPORTANT**: If users ask about files mentioned in the summaries above, politely ask them to re-upload the files as you can only see files in the current conversation context.`;
        }
        
        // Count tokens using Anthropic's API with EXACT payload
        const tokenResponse = await this.countTokensWithRetry({
          model: CLAUDE_SETTINGS.model,
          system: systemPrompt,
          messages: testMessages
        });
        
        accurateTokenCount = tokenResponse.input_tokens;
        
        // Calculate breakdown (approximations for component parts)
        const systemTokens = Math.ceil(systemPrompt.length / 4);
        const summaryTokens = Math.ceil(summaryContext.length / 4);
        const messageTokens = accurateTokenCount - systemTokens - summaryTokens;
        const documentTokens = contextDocuments.length > 0 ? Math.ceil(JSON.stringify(contextDocuments).length / 4) : 0;
        
        tokenBreakdown = {
          summaryTokens,
          messageTokens: Math.max(0, messageTokens - documentTokens),
          documentTokens,
          systemTokens,
          availableForResponse: Math.max(0, TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE - accurateTokenCount - CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_RESPONSE)
        };
        
        logger.info(`📊 Context token breakdown:`);
        logger.info(`  📝 Summary: ${tokenBreakdown.summaryTokens} tokens`);
        logger.info(`  💬 Messages: ${tokenBreakdown.messageTokens} tokens`);
        logger.info(`  📎 Documents: ${tokenBreakdown.documentTokens} tokens`);
        logger.info(`  ⚙️ System: ${tokenBreakdown.systemTokens} tokens`);
        logger.info(`  🎯 Available for response: ${tokenBreakdown.availableForResponse} tokens`);
        logger.info(`  📊 Total context: ${accurateTokenCount} tokens (${((accurateTokenCount / TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE) * 100).toFixed(1)}% of window)`);
        
      } catch (error) {
        logger.error('❌ Error getting accurate token count:', error);
        
        // Fallback estimation
        accurateTokenCount = Math.ceil(
          (summaryContext.length + 
           recentMessages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0) + 
           JSON.stringify(contextDocuments).length) / 4
        );
        
        tokenBreakdown.summaryTokens = Math.ceil(summaryContext.length / 4);
        tokenBreakdown.messageTokens = Math.ceil(recentMessages.reduce((acc, msg) => acc + (msg.content?.length || 0), 0) / 4);
        tokenBreakdown.documentTokens = Math.ceil(JSON.stringify(contextDocuments).length / 4);
        tokenBreakdown.systemTokens = CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_SYSTEM;
        tokenBreakdown.availableForResponse = Math.max(0, TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE - accurateTokenCount - CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_RESPONSE);
        
        logger.warn(`⚠️ Using fallback token estimation: ${accurateTokenCount} tokens`);
      }

      const result = {
        summaryContext,
        recentMessages,
        contextDocuments,
        totalTokenEstimate: accurateTokenCount,
        hasMoreHistory,
        strategy: actualStrategy,
        tokenBreakdown
      };

      logger.info(`✅ Context built: ${recentMessages.length} messages, ${summaries.length} summaries, ${contextDocuments.length} documents`);
      return result;

    } catch (error) {
      logger.error('Error building context with summaries:', error);
      throw new Error(`Failed to build context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count tokens with retry logic (private method for context service)
   */
  private async countTokensWithRetry(
    params: { model: string; system: string; messages: any[] },
    maxRetries: number = 3
  ): Promise<{ input_tokens: number }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.anthropic.messages.countTokens(params);
        return { input_tokens: response.input_tokens };
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) break;
        
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Estimate token count for messages (fallback when API is unavailable)
   */
  private estimateTokenCount(messages: Message[]): number {
    return messages.reduce((total, msg) => {
      // Rough estimation: 4 characters per token
      const contentTokens = Math.ceil((msg.content?.length || 0) / 4);
      const authorTokens = Math.ceil((msg.author?.displayName?.length || msg.author?.username?.length || 0) / 4);
      return total + contentTokens + authorTokens + 5; // +5 for Discord message overhead
    }, 0);
  }
} 