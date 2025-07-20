import Anthropic from '@anthropic-ai/sdk';
import { Message, TextChannel, DMChannel, PartialDMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger } from '@/utils/logger.js';
import { CLAUDE_SETTINGS, TOKEN_MANAGEMENT, CONTEXT_MANAGEMENT } from '@/config/index.js';
import { databaseService } from './database.js';

/**
 * Count tokens with retry logic (standalone version for context builder)
 */
async function countTokensWithRetryStandalone(
  claude: Anthropic,
  params: { model: string; system: string; messages: any[] },
  maxRetries: number = 3
): Promise<{ input_tokens: number }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await claude.messages.countTokens(params);
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
 * Get messages for context using adaptive strategy
 */
export async function getMessagesForContext(
  channel: TextChannel | DMChannel | PartialDMChannel | NewsChannel | ThreadChannel,
  strategy: 'fixed' | 'adaptive' | 'unlimited' = CONTEXT_MANAGEMENT.STRATEGY,
  requestedLimit?: number
): Promise<{ messages: Message[], hasMoreHistory: boolean, strategy: string }> {
  try {
    const database = databaseService;
    
    // Get the latest summary to determine where to start fetching
    const latestSummary = await database.getLatestSummary(channel.id);
    
    let afterMessageId: string | undefined;
    if (latestSummary) {
      afterMessageId = latestSummary.last_message_id;
      logger.info(`📝 Found summary boundary at message ${afterMessageId}`);
    } else {
      logger.info(`📝 No existing summaries for channel`);
    }
    
    // Determine fetch limit based on strategy
    let fetchLimit: number;
    let actualStrategy = strategy;
    
    switch (strategy) {
      case 'fixed':
        fetchLimit = requestedLimit || CONTEXT_MANAGEMENT.FIXED_MESSAGE_LIMIT;
        logger.info(`📊 Using FIXED strategy: ${fetchLimit} messages`);
        break;
        
      case 'adaptive':
        fetchLimit = requestedLimit || CONTEXT_MANAGEMENT.ADAPTIVE_INITIAL_LIMIT;
        logger.info(`📊 Using ADAPTIVE strategy: starting with ${fetchLimit} messages`);
        break;
        
      case 'unlimited':
        fetchLimit = CONTEXT_MANAGEMENT.UNLIMITED_SAFETY_LIMIT;
        logger.info(`📊 Using UNLIMITED strategy: up to ${fetchLimit} messages (safety limit)`);
        break;
        
      default:
        fetchLimit = CONTEXT_MANAGEMENT.FIXED_MESSAGE_LIMIT;
        actualStrategy = 'fixed';
        logger.info(`📊 Unknown strategy '${strategy}', falling back to FIXED: ${fetchLimit} messages`);
    }
    
    // Fetch messages using Discord's pagination
    const messages: Message[] = [];
    let hasMoreHistory = false;
    let totalFetched = 0;
    let lastMessageId: string | undefined = afterMessageId;
    
    // For unlimited strategy, keep fetching until we hit the limit or run out
    const maxIterations = strategy === 'unlimited' ? 10 : 1; // Prevent infinite loops
    
    for (let iteration = 0; iteration < maxIterations && totalFetched < fetchLimit; iteration++) {
      const remainingToFetch = Math.min(fetchLimit - totalFetched, 100); // Discord's max per request
      
      const fetchOptions: any = {
        limit: remainingToFetch,
      };
      
      if (lastMessageId) {
        fetchOptions.after = lastMessageId;
      }
      
      try {
        const fetchedMessages = await (channel as any).messages.fetch(fetchOptions);
        
        if (fetchedMessages.size === 0) {
          // No more messages available
          break;
        }
        
        // Convert to array and sort chronologically (oldest first)
        const messageArray = Array.from(fetchedMessages.values())
          .sort((a: any, b: any) => a.createdTimestamp - b.createdTimestamp);
        
        messages.push(...(messageArray as any[]));
        totalFetched += messageArray.length;
        
        // Update last message ID for next iteration
        const newestMessage = messageArray[messageArray.length - 1] as any;
        lastMessageId = newestMessage?.id;
        
        hasMoreHistory = fetchedMessages.size === remainingToFetch;
        
        // For fixed/adaptive strategies, break after first fetch
        if (strategy !== 'unlimited') {
          break;
        }
        
        logger.info(`📨 Iteration ${iteration + 1}: Fetched ${messageArray.length} messages (total: ${totalFetched})`);
        
      } catch (error) {
        logger.error('❌ Error fetching messages:', error);
        throw error;
      }
    }
    
    logger.info(`📨 Final result: ${messages.length} messages using ${actualStrategy} strategy`);
    return {
      messages,
      hasMoreHistory,
      strategy: actualStrategy
    };
    
  } catch (error) {
    logger.error('❌ Error in getMessagesForContext:', error);
    throw error;
  }
}

/**
 * Build complete context including summaries and recent messages
 */
export async function buildContextWithSummaries(
  channel: TextChannel | DMChannel | PartialDMChannel | NewsChannel | ThreadChannel,
  strategy: 'fixed' | 'adaptive' | 'unlimited' = CONTEXT_MANAGEMENT.STRATEGY,
  requestedLimit?: number,
  currentMessage?: Message, // Add current message for attachment processing
  attachmentProcessor?: (message: Message, existingAttachments: any[], messageLimit: number) => Promise<any[]> // Add messageLimit parameter
): Promise<{ 
  summaryContext: string;
  recentMessages: Message[];
  contextDocuments: any[]; // Add documents from context
  totalTokenEstimate: number;
  hasMoreHistory: boolean;
  strategy: string;
  tokenBreakdown: {
    summaryTokens: number;
    messageTokens: number;
    documentTokens: number; // Add document tokens
    systemTokens: number;
    availableForResponse: number;
  };
}> {
  try {
    const database = databaseService;
    
    // Get all summaries for this channel
    const summaries = await database.getAllSummaries(channel.id);
    
    // Get recent messages after the last summary using selected strategy
    const { messages: recentMessages, hasMoreHistory, strategy: actualStrategy } = await getMessagesForContext(
      channel, 
      strategy,
      requestedLimit
    );
    
    // Process deduplicated documents from context if processor provided
    let contextDocuments: any[] = [];
    if (currentMessage && attachmentProcessor) {
      logger.info('🔍 Processing context documents with deduplication...');
      contextDocuments = await attachmentProcessor(currentMessage, [], recentMessages.length + 1); // +1 for current message
      logger.info(`📎 Found ${contextDocuments.length} unique document(s) in context`);
    }
    
    // Build summary context string
    let summaryContext = '';
    if (summaries.length > 0) {
      summaryContext = '## Previous Conversation Summaries:\n\n';
      
      summaries.forEach((summary, index) => {
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
      documentTokens: 0, // Add document tokens
      systemTokens: CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_SYSTEM,
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
      let systemPrompt = CLAUDE_SETTINGS.systemPrompt;
      if (summaryContext) {
        systemPrompt = `${summaryContext}\n\n${CLAUDE_SETTINGS.systemPrompt}\n\n**IMPORTANT**: If users ask about files mentioned in the summaries above, politely ask them to re-upload the files as you can only see files in the current conversation context.`;
      }
      
      // Count tokens using Anthropic's API with EXACT payload - create temporary client for standalone function
      const claude = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!
      });
      
      const response = await countTokensWithRetryStandalone(claude, {
        model: CLAUDE_SETTINGS.model,
        system: systemPrompt,
        messages: testMessages
      });
      
      accurateTokenCount = response.input_tokens;
      
      // Calculate breakdown (more accurate estimates for breakdown)
      const summaryTokens = summaryContext ? Math.ceil(summaryContext.length / 4) : 0;
      const systemTokens = CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_SYSTEM;
      
      // Estimate document tokens (rough estimate for breakdown)
      const documentTokens = contextDocuments.reduce((total, doc) => {
        if (doc.type === 'text' && doc.text) {
          // Text content - standard token estimate
          return total + Math.ceil(doc.text.length / 4);
        } else if (doc.source?.data) {
          // Base64 content (PDFs) - rough estimate
          return total + Math.ceil(doc.source.data.length / 6);
        }
        return total;
      }, 0);
      
      const messageTokens = Math.max(0, accurateTokenCount - summaryTokens - documentTokens - systemTokens);
      
      tokenBreakdown = {
        summaryTokens,
        messageTokens,
        documentTokens,
        systemTokens,
        availableForResponse: Math.max(0, TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE - accurateTokenCount)
      };
      
      logger.info(`🔢 Context tokens: ${accurateTokenCount} (via Anthropic API)`);
      
    } catch (error) {
      logger.error('❌ Error getting accurate token count, falling back to estimates:', error);
      // Fallback to rough estimates
      const summaryTokens = Math.ceil(summaryContext.length / 4);
      const messageTokens = recentMessages.reduce((total, msg) => {
        return total + Math.ceil((msg.content || '').length / 4);
      }, 0);
      const documentTokens = contextDocuments.reduce((total, doc) => {
        if (doc.type === 'text' && doc.text) {
          // Text content - standard token estimate
          return total + Math.ceil(doc.text.length / 4);
        } else if (doc.source?.data) {
          // Base64 content (PDFs) - rough estimate
          return total + Math.ceil(doc.source.data.length / 6);
        }
        return total;
      }, 0);
      
      accurateTokenCount = summaryTokens + messageTokens + documentTokens + CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_SYSTEM;
      
      tokenBreakdown = {
        summaryTokens,
        messageTokens,
        documentTokens,
        systemTokens: CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_SYSTEM,
        availableForResponse: Math.max(0, TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE - accurateTokenCount)
      };
    }
    
    logger.info(`🧠 Context built (${actualStrategy}): ${summaries.length} summaries, ${recentMessages.length} messages, ${contextDocuments.length} documents`);
    logger.info(`📊 Token breakdown: ${tokenBreakdown.summaryTokens}+${tokenBreakdown.messageTokens}+${tokenBreakdown.documentTokens}+${tokenBreakdown.systemTokens} = ${accurateTokenCount} total`);
    logger.info(`🎯 Available for response: ${tokenBreakdown.availableForResponse} tokens (${((tokenBreakdown.availableForResponse / TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE) * 100).toFixed(1)}% remaining)`);
    
    return {
      summaryContext,
      recentMessages,
      contextDocuments, // Return documents
      totalTokenEstimate: accurateTokenCount,
      hasMoreHistory,
      strategy: actualStrategy,
      tokenBreakdown
    };
    
  } catch (error) {
    logger.error('❌ Error building context with summaries:', error);
    throw error;
  }
} 