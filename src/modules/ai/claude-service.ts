import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_SETTINGS, DELEGATE_CLAUDE_SETTINGS, TOKEN_MANAGEMENT } from '../infra/config';
import { logger } from '../infra/logging';
import { AIService } from '../discord/types';
import { TextChannel, DMChannel, PartialDMChannel, NewsChannel, ThreadChannel, ChannelType } from 'discord.js';

// Extended tool type for web search and other tools
interface ExtendedTool {
  type?: "web_search_20250305" | "computer_20241022" | "text_editor_20241022" | "bash_20241022";
  name: string;
  description?: string;
  input_schema?: any;
  max_uses?: number;
  blocked_domains?: string[];
  allowed_domains?: string[];
}

// Thread context for tool operations
interface ThreadContext {
  discordClient?: any;
  currentChannel?: any;
  currentMessage?: any;
}

// Thread query response type
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

// Delegate Claude singleton for thread queries
let delegateClaudeClient: Anthropic | null = null;

// Rate limiting for delegate queries
const delegateQueryQueue: Array<() => Promise<any>> = [];
let activeQueries = 0;
const MAX_CONCURRENT_DELEGATE_QUERIES = 3;

// Circuit breaker for API resilience
let circuitBreakerFailures = 0;
let circuitBreakerLastFailure = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT = 60000;

function isCircuitBreakerOpen(): boolean {
  if (circuitBreakerFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    const timeSinceLastFailure = Date.now() - circuitBreakerLastFailure;
    if (timeSinceLastFailure < CIRCUIT_BREAKER_TIMEOUT) {
      return true;
    } else {
      circuitBreakerFailures = 0;
      logger.info('🔄 Circuit breaker reset - attempting to resume delegate queries');
      return false;
    }
  }
  return false;
}

function recordCircuitBreakerSuccess(): void {
  if (circuitBreakerFailures > 0) {
    circuitBreakerFailures = 0;
    logger.info('✅ Circuit breaker success recorded - failures reset');
  }
}

function recordCircuitBreakerFailure(): void {
  circuitBreakerFailures++;
  circuitBreakerLastFailure = Date.now();
  logger.error(`❌ Circuit breaker failure recorded (${circuitBreakerFailures}/${CIRCUIT_BREAKER_THRESHOLD})`);
}

async function executeWithRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      if (activeQueries >= MAX_CONCURRENT_DELEGATE_QUERIES) {
        delegateQueryQueue.push(execute);
        return;
      }

      activeQueries++;
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        activeQueries--;
        if (delegateQueryQueue.length > 0) {
          const nextOperation = delegateQueryQueue.shift();
          if (nextOperation) {
            setTimeout(nextOperation, 100);
          }
        }
      }
    };

    execute();
  });
}

/**
 * Enhanced Claude AI Service
 * Consolidates all AI functionality: conversation processing, tools, delegation, streaming
 */
export class ClaudeAIService implements AIService {
  private claude: Anthropic;
  private threadContext: ThreadContext = {};

  constructor(apiKey?: string) {
    const claudeApiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!claudeApiKey) {
      throw new Error('ANTHROPIC_API_KEY must be provided either as parameter or environment variable');
    }

    this.claude = new Anthropic({
      apiKey: claudeApiKey,
      defaultHeaders: CLAUDE_SETTINGS.model.includes('claude-4') ? {
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      } : {}
    });
  }

  /**
   * Set Discord context for thread operations
   */
  setThreadContext(context: ThreadContext): void {
    this.threadContext = context;
    logger.info('🔧 Thread context set for AI service');
  }

  /**
   * Health check for the AI service
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.countTokensWithRetry({
        model: CLAUDE_SETTINGS.model,
        system: 'test',
        messages: [{ role: 'user', content: 'test' }]
      });
      return true;
    } catch (error) {
      logger.error('Claude health check failed:', error);
      return false;
    }
  }

  /**
   * Process conversation with legacy interface
   */
  async processConversation(
    prompt: string, 
    messageHistory: any[], 
    attachments?: any[]
  ): Promise<string> {
    try {
      const messages = messageHistory.map(msg => ({
        role: (msg.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.content
      }));

      let currentContent: any = prompt;
      if (attachments && attachments.length > 0) {
        currentContent = [
          { type: 'text', text: prompt },
          ...attachments
        ];
      }

      messages.push({
        role: 'user' as const,
        content: currentContent
      });

      const response = await this.claude.messages.create({
        model: CLAUDE_SETTINGS.model,
        max_tokens: CLAUDE_SETTINGS.maxTokens,
        system: CLAUDE_SETTINGS.systemPrompt,
        messages,
        temperature: CLAUDE_SETTINGS.temperature
      });

      return response.content[0].type === 'text' ? response.content[0].text : 'Sorry, I could not generate a response.';

    } catch (error) {
      logger.error('Error in processConversation:', error);
      throw error;
    }
  }

  /**
   * Process conversation with smart context and full tool support
   */
  async processWithSmartContext(
    prompt: string,
    smartContext: {
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
    },
    enableWebSearch = true
  ): Promise<string> {
    try {
      const messages = this.buildMessageHistoryFromSmartContext(smartContext, prompt);
      
      // Build system prompt with summary context
      let systemPrompt: string = CLAUDE_SETTINGS.systemPrompt;
      if (smartContext.summaryContext) {
        systemPrompt = `${smartContext.summaryContext}\n\n${CLAUDE_SETTINGS.systemPrompt}\n\n**IMPORTANT**: If users ask about files mentioned in the summaries above, politely ask them to re-upload the files as you can only see files in the current conversation context.`;
      }

      // Get accurate token count
      let accurateTokenCount = 0;
      try {
        const tokenResponse = await this.countTokensWithRetry({
          model: CLAUDE_SETTINGS.model,
          system: systemPrompt,
          messages: messages
        });
        accurateTokenCount = tokenResponse.input_tokens;
        
        const usagePercent = (accurateTokenCount / TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE) * 100;
        if (usagePercent > 80) {
          logger.warn(`⚠️ HIGH TOKEN USAGE: ${usagePercent.toFixed(1)}% of context window`);
        } else {
          logger.info(`✅ Token usage: ${usagePercent.toFixed(1)}% of context window`);
        }
      } catch (error) {
        logger.error('❌ Error getting token count:', error);
        accurateTokenCount = JSON.stringify(messages).length / 4;
      }

      // Configure tools
      const tools: ExtendedTool[] = [];

      // Add web search tool if enabled
      if (enableWebSearch) {
        tools.push({
          type: "web_search_20250305",
          name: "web_search"
        } as any);
      }

      // Add thread management tools
      tools.push(
        {
          name: "create_thread",
          description: "Create a new Discord thread for focused discussion",
          input_schema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Thread name (max 100 chars)" },
              purpose: { type: "string", description: "Brief description of thread purpose" },
              initial_message: { type: "string", description: "First message in the thread" },
              use_current_message: { type: "boolean", description: "Create from current message", default: false }
            },
            required: ["name", "purpose", "initial_message"]
          }
        } as any,
        {
          name: "list_threads",
          description: "Get list of available threads in current channel",
          input_schema: {
            type: "object",
            properties: {
              include_archived: { type: "boolean", description: "Include archived threads", default: false }
            },
            required: []
          }
        } as any,
        {
          name: "query_thread_context",
          description: "Query thread content using delegate Claude instance",
          input_schema: {
            type: "object",
            properties: {
              thread_id: { type: "string", description: "Thread ID from list_threads" },
              query: { type: "string", description: "Specific question about thread content" },
              context_hint: { type: "string", description: "Additional context for the query" }
            },
            required: ["thread_id", "query"]
          }
        } as any
      );

      const streamParams: any = {
        model: CLAUDE_SETTINGS.model,
        max_tokens: CLAUDE_SETTINGS.maxTokens,
        temperature: CLAUDE_SETTINGS.temperature,
        system: systemPrompt,
        messages,
        stream: true,
        tools: tools.length > 0 ? tools as any : undefined
      };

      // Add thinking for Claude 4
      if (CLAUDE_SETTINGS.model.includes('claude-4')) {
        streamParams.thinking = {
          type: 'enabled',
          budget_tokens: Math.min(16000, CLAUDE_SETTINGS.maxTokens - 1000)
        };
      }

      return await this.handleStreamingResponse(streamParams);

    } catch (error) {
      logger.error('Error in processWithSmartContext:', error);
      throw error;
    }
  }

  /**
   * Handle streaming response with tool execution
   */
  private async handleStreamingResponse(streamParams: any): Promise<string> {
    const stream = await this.createMessageWithRetry(streamParams);
    let responseText = '';
    let toolUses: any[] = [];

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text') {
        responseText += chunk.delta.text;
      } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
        toolUses.push(chunk.content_block);
      } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
        if (toolUses.length > 0) {
          const lastTool = toolUses[toolUses.length - 1];
          if (!lastTool.input) lastTool.input = '';
          lastTool.input += chunk.delta.partial_json;
        }
      }
    }

    // Process tool uses
    if (toolUses.length > 0) {
      const toolResults = [];
      for (const toolUse of toolUses) {
        try {
          const result = await this.handleToolUse({
            name: toolUse.name,
            input: JSON.parse(toolUse.input || '{}')
          });
          if (result) {
            toolResults.push(result);
          }
        } catch (error) {
          logger.error(`Tool execution error for ${toolUse.name}:`, error);
          toolResults.push(`Error using ${toolUse.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      if (toolResults.length > 0) {
        responseText += '\n\n' + toolResults.join('\n\n');
      }
    }

    return responseText || 'Sorry, I could not generate a response.';
  }

  /**
   * Handle tool use requests
   */
  private async handleToolUse(toolUse: { name: string; input: any }): Promise<string | null> {
    try {
      switch (toolUse.name) {
        case 'create_thread':
          return await this.handleCreateThread(toolUse.input);
        case 'list_threads':
          return await this.handleListThreads(toolUse.input);
        case 'query_thread_context':
          return await this.handleQueryThreadContext(toolUse.input);
        default:
          logger.warn(`Unknown tool: ${toolUse.name}`);
          return null;
      }
    } catch (error) {
      logger.error(`Error handling tool ${toolUse.name}:`, error);
      return `Error using ${toolUse.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Create thread tool handler
   */
  private async handleCreateThread(input: any): Promise<string> {
    const { name, purpose, initial_message, use_current_message = false } = input;

    if (!this.threadContext.currentChannel) {
      throw new Error('No channel context available for thread creation');
    }

    if (!name || !purpose || !initial_message) {
      throw new Error('Thread creation requires name, purpose, and initial_message');
    }

    try {
      let thread;
      if (use_current_message && this.threadContext.currentMessage) {
        thread = await this.threadContext.currentMessage.startThread({
          name: name.substring(0, 100),
          autoArchiveDuration: 1440,
          reason: `Thread created for: ${purpose}`
        });
      } else {
        thread = await this.threadContext.currentChannel.threads.create({
          name: name.substring(0, 100),
          autoArchiveDuration: 1440,
          type: ChannelType.PublicThread,
          reason: `Thread created for: ${purpose}`
        });
      }

      // Send initial message
      await thread.send(initial_message);

      return `✅ **Thread Created Successfully!**

**Thread:** ${thread.name} (ID: ${thread.id})
**Purpose:** ${purpose}
**Channel:** <#${thread.id}>

The thread has been created and is ready for discussion. Click the thread link above to join the conversation!`;

    } catch (error) {
      logger.error('Error creating thread:', error);
      throw new Error(`Failed to create thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List threads tool handler
   */
  private async handleListThreads(input: any): Promise<string> {
    const { include_archived = false } = input;

    if (!this.threadContext.currentChannel) {
      throw new Error('No channel context available for listing threads');
    }

    try {
      const fetchOptions: any = {};
      if (include_archived) {
        fetchOptions.archived = { before: new Date(), limit: 100 };
      }

      const fetchedThreads = await this.threadContext.currentChannel.threads.fetch(fetchOptions);
      const threads = Array.from(fetchedThreads.threads.values());

      if (threads.length === 0) {
        return '📭 **No threads found in this channel.**\n\nYou can create a new thread using the create_thread tool.';
      }

      let response = `📋 **Available Threads** (${threads.length} found)\n\n`;

      threads.forEach((thread: any, index: number) => {
        const isArchived = thread.archived ? ' 📦 *Archived*' : '';
        const memberCount = thread.memberCount || 0;
        const lastMessage = thread.lastMessage?.createdAt?.toLocaleDateString() || 'Unknown';
        
        response += `**${index + 1}. ${thread.name}**${isArchived}\n`;
        response += `   • ID: \`${thread.id}\`\n`;
        response += `   • Members: ${memberCount}\n`;
        response += `   • Last activity: ${lastMessage}\n`;
        response += `   • Link: <#${thread.id}>\n\n`;
      });

      response += '*Use query_thread_context with a thread ID to ask questions about specific thread content.*';

      return response;

    } catch (error) {
      logger.error('Error listing threads:', error);
      throw new Error(`Failed to list threads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Query thread context tool handler using delegate Claude
   */
  private async handleQueryThreadContext(input: any): Promise<string> {
    const { thread_id, query, context_hint } = input;

    if (!thread_id || !query) {
      throw new Error('Thread ID and query are required');
    }

    if (isCircuitBreakerOpen()) {
      throw new Error('Delegate Claude service temporarily unavailable (circuit breaker open)');
    }

    try {
      // Get thread channel
      const threadChannel = await this.getThreadChannel(thread_id);
      
      // Build context for delegate Claude (simplified version)
      const messages = await threadChannel.messages.fetch({ limit: 50 });
      const messageArray = Array.from(messages.values()).reverse();
      
      const contextMessages = messageArray.map((msg: any) => ({
        role: (msg.author.bot ? 'assistant' : 'user') as 'user' | 'assistant',
        content: msg.content
      })).filter(msg => msg.content.trim());

      // Build delegate prompt
      const delegatePrompt = `You are a specialized Claude instance analyzing this Discord thread to answer a specific question.

**Thread:** ${threadChannel.name}
**Question:** "${query}"
${context_hint ? `**Context:** ${context_hint}` : ''}

Please provide a focused answer based on the thread content. Be specific and cite relevant information from the messages.`;

      const delegateMessages = [...contextMessages, {
        role: 'user' as const,
        content: delegatePrompt
      }];

      // Call delegate Claude
      const response = await executeWithRateLimit(() => this.callDelegateClaudeWithRetry({
        model: DELEGATE_CLAUDE_SETTINGS.model,
        max_tokens: DELEGATE_CLAUDE_SETTINGS.maxTokens,
        temperature: DELEGATE_CLAUDE_SETTINGS.temperature,
        system: DELEGATE_CLAUDE_SETTINGS.systemPrompt,
        messages: delegateMessages
      }));

      recordCircuitBreakerSuccess();

      const answer = response.content[0].type === 'text' ? response.content[0].text : 'No response generated';

      return `🧵 **Thread Query Result**

**Thread:** ${threadChannel.name}
**Query:** "${query}"
${context_hint ? `**Context:** ${context_hint}` : ''}

**Answer:**
${answer}

**Source:** Analyzed ${messageArray.length} messages from thread
**Tokens:** ${response.usage?.input_tokens || 0} input + ${response.usage?.output_tokens || 0} output`;

    } catch (error) {
      recordCircuitBreakerFailure();
      logger.error('Error in handleQueryThreadContext:', error);
      throw new Error(`Failed to query thread context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get thread channel by ID
   */
  private async getThreadChannel(threadId: string): Promise<any> {
    if (!this.threadContext.discordClient) {
      throw new Error('Discord client not available in thread context');
    }

    try {
      const channel = await this.threadContext.discordClient.channels.fetch(threadId);
      if (!channel || !channel.isThread()) {
        throw new Error(`Thread ${threadId} not found or is not a thread`);
      }
      return channel;
    } catch (error) {
      throw new Error(`Failed to fetch thread ${threadId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build message history from smart context
   */
  private buildMessageHistoryFromSmartContext(
    smartContext: {
      recentMessages: any[];
      contextDocuments?: any[];
    },
    currentPrompt?: string
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    // Add context documents
    if (smartContext.contextDocuments && smartContext.contextDocuments.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: 'Context documents from conversation history:' },
          ...smartContext.contextDocuments
        ]
      });
    }

    // Convert recent messages
    if (smartContext.recentMessages) {
      for (const msg of smartContext.recentMessages) {
        if (!msg.content || msg.content.trim() === '') continue;
        
        let role: 'user' | 'assistant' = 'user';
        let content: string = msg.content;
        
        if (msg.author?.bot && msg.author?.id === this.threadContext.discordClient?.user?.id) {
          role = 'assistant';
        } else {
          if (msg.guild && msg.author?.displayName) {
            content = `${msg.author.displayName}: ${content}`;
          }
        }
        
        messages.push({ role, content });
      }
    }

    // Add current prompt
    if (currentPrompt) {
      messages.push({
        role: 'user',
        content: currentPrompt
      });
    }

    return messages;
  }

  /**
   * Count tokens with retry logic
   */
  async countTokensWithRetry(
    params: { model: string; system: string; messages: any[] },
    maxRetries: number = 3
  ): Promise<{ input_tokens: number }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.claude.messages.countTokens(params);
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
   * Create message with retry logic
   */
  private async createMessageWithRetry(params: any, maxRetries: number = 3): Promise<any> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.claude.messages.create(params);
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
   * Call delegate Claude with retry logic
   */
  private async callDelegateClaudeWithRetry(params: any, maxRetries: number = 3): Promise<any> {
    // Initialize delegate client if needed
    if (!delegateClaudeClient) {
      delegateClaudeClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await delegateClaudeClient.messages.create(params);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === maxRetries) break;
        
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
} 