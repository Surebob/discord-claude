import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_SETTINGS, TOKEN_MANAGEMENT, CONTEXT_MANAGEMENT } from '@/config/index.js';
import { ClaudeResponse, MessageHistory } from '@/types/index.js';
import { logger } from '@/utils/logger.js';
// config import removed - no longer needed after cleanup
// attachments utils removed - handling attachments directly in Discord client now
import { databaseService } from './database.js';
import { ThreadQueryService } from './thread-query.js';
import { buildContextWithSummaries, getMessagesForContext } from './context-builder.js';
import { Message, TextChannel, DMChannel, PartialDMChannel, NewsChannel, ThreadChannel, User } from 'discord.js';
// Removed threadManager - using Discord API directly

// Extend Anthropic types to include web search tool
// Note: Web search was recently released (May 2025) and SDK types haven't been updated yet
// Remove this when @anthropic-ai/sdk includes web_search_20250305 in official types
interface WebSearchTool {
  type: "web_search_20250305";
  name: string;
  max_uses?: number;
  blocked_domains?: string[];
  allowed_domains?: string[];
}

  // Union type for all tools including web search
  interface ExtendedTool {
    type?: "web_search_20250305" | "computer_20241022" | "text_editor_20241022" | "bash_20241022";
    name: string;
    description?: string;    // Only for client tools
    input_schema?: any;      // Only for client tools
    max_uses?: number;       // For server tools like web_search
    blocked_domains?: string[]; // For server tools like web_search
  }

interface ThreadContext {
  discordClient?: any; // We'll properly type this when integrating
  currentChannel?: any;
  currentMessage?: any;
  // conversationContext removed - we now read Discord history directly
}

export class ClaudeService {
  private anthropic: Anthropic;
  private threadContext: ThreadContext = {};
  private threadQueryService?: ThreadQueryService;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Enable interleaved thinking for Claude 4 models
      defaultHeaders: CLAUDE_SETTINGS.model.includes('claude-4') ? {
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      } : {}
    });
  }

  /**
   * Set Discord context for thread operations and initialize thread query service
   */
  setThreadContext(context: ThreadContext, attachmentProcessor?: (message: any, existingAttachments: any[], messageLimit: number) => Promise<any[]>): void {
    this.threadContext = context;
    
    // Initialize thread query service with Discord client and attachment processor
    if (context.discordClient) {
      this.threadQueryService = new ThreadQueryService(context.discordClient, attachmentProcessor);
      logger.info('🔧 Thread query service initialized');
    }
  }

  /**
   * Generate a response from Claude with smart context and native web search support
   */
  async generateResponse(
    prompt: string, // Current message text only
    smartContext?: { 
      summaryContext: string;
      recentMessages: any[];
      contextDocuments: any[]; // Documents from context
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
  ): Promise<ClaudeResponse> {
    try {
      const messages = this.buildMessageHistoryFromSmartContext(smartContext, prompt);
      
      // Build system prompt with optional summary context (same as in buildContextWithSummaries)
      let systemPrompt = CLAUDE_SETTINGS.systemPrompt;
      if (smartContext && smartContext.summaryContext) {
        systemPrompt = `${smartContext.summaryContext}\n\n${CLAUDE_SETTINGS.systemPrompt}\n\n**IMPORTANT**: If users ask about files mentioned in the summaries above, politely ask them to re-upload the files as you can only see files in the current conversation context.`;
      }
      
             // Get ACCURATE token count including current prompt and attachments
       let accurateTokenCount = 0;
       try {
         const tokenResponse = await this.countTokensWithRetry({
           model: CLAUDE_SETTINGS.model,
           system: systemPrompt,
           messages: messages
         });
                  accurateTokenCount = tokenResponse.input_tokens;
         
         // Calculate detailed breakdown
         const contextTokens = smartContext?.totalTokenEstimate || 0;
         const currentMessageTokens = Math.ceil((prompt || '').length / 4); // Rough estimate for current message only
         const totalCurrentRequestTokens = accurateTokenCount - contextTokens;
         
         logger.info(`🔢 Request breakdown:`);
         logger.info(`  📊 Total request: ${accurateTokenCount} tokens (Anthropic API)`);
         logger.info(`  📚 Context baseline: ${contextTokens} tokens (pre-built)`);
         logger.info(`  💬 Current text only: ${currentMessageTokens} tokens ("${prompt}")`);
         logger.info(`  🔄 Request overhead: ${totalCurrentRequestTokens} tokens (includes processing)`);
         
         // Check if we're approaching limits
         const usagePercent = (accurateTokenCount / TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE) * 100;
         if (usagePercent > 80) {
           logger.warn(`⚠️ HIGH TOKEN USAGE: ${usagePercent.toFixed(1)}% of context window (${accurateTokenCount}/${TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE})`);
         } else {
           logger.info(`✅ Total token usage: ${usagePercent.toFixed(1)}% of context window (${accurateTokenCount}/${TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE})`);
         }
      } catch (error) {
        logger.error('❌ Error getting accurate token count for current request:', error);
        accurateTokenCount = JSON.stringify(messages).length / 4; // Fallback estimate
      }
      
      // Configure tools - native web search support + thread tools
      const tools: ExtendedTool[] = [];
      
      if (enableWebSearch && this.supportsWebSearch()) {
        tools.push({
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
          blocked_domains: ["spam.com", "untrustedsource.com"]
        });
      }

      // DEBUG: Calculate total prompt size
      const totalPromptLength = JSON.stringify(messages).length;
      const hasWebSearch = tools.some(tool => tool.type === 'web_search_20250305');
      logger.info(`🤖 Generating Claude response${hasWebSearch ? ' with web search' : ''}`);
      logger.info(`📊 Using max_tokens: ${CLAUDE_SETTINGS.maxTokens}`);
      logger.info(`📏 Total prompt size: ${totalPromptLength} characters`);
      
      // DEBUG: Log each message in the prompt
      logger.info('🔍 DEBUG: Final prompt messages:');
      messages.forEach((msg, i) => {
        const msgStr = JSON.stringify(msg);
        const msgLength = msgStr.length;
        const preview = msgLength > 300 ? msgStr.slice(0, 300) + '...' : msgStr;
        logger.info(`  ${i+1}. [${msg.role}] ${msgLength} chars: ${preview}`);
      });

      // Add thread management tools using Anthropic's current format
      tools.push(
        {
          name: "create_thread",
          description: "Create a new Discord thread for focused discussion on a specific topic. Use this when a conversation would benefit from being separated into its own thread (e.g., detailed planning, code review, brainstorming, artifact creation). REQUIRED: You must provide name, purpose, and initial_message parameters.",
          input_schema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "REQUIRED: Name for the thread (max 100 characters). Example: 'Code Review Session' or 'Project Planning'"
              },
              purpose: {
                type: "string", 
                description: "REQUIRED: Brief description of what this thread is for. Example: 'Reviewing the authentication code' or 'Planning the new feature'"
              },
              initial_message: {
                type: "string",
                description: "REQUIRED: First message to post in the thread. This should provide context and start the discussion."
              },
              use_current_message: {
                type: "boolean",
                description: "OPTIONAL: Whether to create the thread from the current message (true) or as a standalone thread (false). Defaults to false.",
                default: false
              }
            },
            required: ["name", "purpose", "initial_message"]
          }
        } as any,
        {
          name: "list_threads",
          description: "Get a list of all available threads in the current channel. Use this when you need to find threads related to a topic or see what discussions are available.",
          input_schema: {
            type: "object",
            properties: {
              include_archived: {
                type: "boolean",
                description: "OPTIONAL: Whether to include archived threads. Defaults to false.",
                default: false
              }
            },
            required: []
          }
        } as any,
        {
          name: "query_thread_context",
          description: "Ask a specific question about a thread's content using an intelligent delegate system. This tool spawns a specialized Claude instance with FULL thread context (summaries, messages, documents) to answer your specific question without polluting your own context. Use this when you need detailed information from threads.",
          input_schema: {
            type: "object",
            properties: {
              thread_id: {
                type: "string",
                description: "REQUIRED: The Discord thread ID to query (get from list_threads first). Never guess - use exact ID from list_threads results."
              },
              query: {
                type: "string",
                description: "REQUIRED: Specific question you want answered about the thread content. Be precise about what information you're looking for. Examples: 'What were the final decisions about the API design?', 'What files were shared and what do they contain?', 'What are the performance requirements mentioned?'"
              },
              context_hint: {
                type: "string",
                description: "OPTIONAL: Additional context about why you're asking this question, to help focus the search and provide better answers."
              }
            },
            required: ["thread_id", "query"]
          }
        } as any
      );

      logger.info(`🛠️ Tools being sent to Claude: ${tools.length} tools`);
      tools.forEach((tool, i) => {
        logger.info(`  ${i + 1}. ${tool.name} (${tool.type || 'function'})`);
      });

      // System prompt already built above for token counting

      const streamParams: any = {
        model: CLAUDE_SETTINGS.model,
        max_tokens: CLAUDE_SETTINGS.maxTokens,
        temperature: CLAUDE_SETTINGS.temperature,
        system: systemPrompt,
        messages,
        stream: true,
        tools: tools.length > 0 ? tools as any : undefined
      };

      // Add thinking configuration for Claude 4 models
      if (CLAUDE_SETTINGS.model.includes('claude-4')) {
        streamParams.thinking = {
          type: 'enabled',
          budget_tokens: Math.min(16000, CLAUDE_SETTINGS.maxTokens - 1000)
        };
      }

      const stream = await this.createMessageWithRetry(streamParams);

      // Handle streaming response and tool use
      let textContent = '';
      let toolUseBlocks: any[] = [];

      logger.info('🔄 Starting to process streaming events...');

      for await (const messageStreamEvent of stream) {
        // Only log tool-related events, not every text delta
        if (messageStreamEvent.type !== 'content_block_delta' || (messageStreamEvent as any).delta?.type === 'input_json_delta') {
          logger.info(`📨 Stream event: ${messageStreamEvent.type}`, {
            type: messageStreamEvent.type,
            index: (messageStreamEvent as any).index,
            delta: (messageStreamEvent as any).delta
          });
        }

                  if (messageStreamEvent.type === 'content_block_delta') {
            const delta = (messageStreamEvent as any).delta;
            const blockIndex = (messageStreamEvent as any).index;
            
            if (delta.type === 'text_delta') {
              textContent += delta.text;
              // Don't log every text delta - too verbose
            } else if (delta.type === 'thinking_delta') {
              // Log thinking content but don't add to final response
              logger.info(`🧠 Claude thinking: ${delta.thinking}`);
            } else if (delta.type === 'input_json_delta') {
              // Handle tool input parameters streaming in
              logger.info(`🔧 Tool input delta for block ${blockIndex}:`, JSON.stringify(delta));
              
              // Find the correct tool block - blockIndex might not match array index
              let targetBlock = null;
              for (let i = 0; i < toolUseBlocks.length; i++) {
                if (i === blockIndex || toolUseBlocks[i]._blockIndex === blockIndex) {
                  targetBlock = toolUseBlocks[i];
                  break;
                }
              }
              
              if (targetBlock && delta.partial_json) {
                if (!targetBlock.input) {
                  targetBlock.input = {};
                }
                // Accumulate JSON input as it streams
                if (!targetBlock._inputBuffer) {
                  targetBlock._inputBuffer = '';
                }
                targetBlock._inputBuffer += delta.partial_json;
                logger.info(`📦 Accumulated buffer for block ${blockIndex}:`, targetBlock._inputBuffer);
              } else {
                if (!targetBlock) {
                  // Race condition: create tool block on-the-fly if we receive input_json_delta before content_block_start
                  logger.info(`🔧 Creating tool block on-the-fly for index ${blockIndex} (race condition fix)`);
                  const newToolBlock = {
                    type: 'unknown', // Will be updated when content_block_start arrives
                    id: `temp_${blockIndex}`,
                    name: 'unknown',
                    input: {},
                    _inputBuffer: '',
                    _blockIndex: blockIndex
                  };
                  toolUseBlocks.push(newToolBlock);
                  targetBlock = newToolBlock;
                  
                  if (delta.partial_json) {
                    targetBlock._inputBuffer = delta.partial_json;
                  }
                } else if (!delta.partial_json) {
                  logger.warn(`⚠️ Empty partial_json in delta:`, delta);
                }
              }
            } else {
              // Log all unknown delta types to see what we're missing
              logger.info(`🔍 Unknown delta type:`, delta.type, 'Content:', JSON.stringify(delta));
            }
                  } else if (messageStreamEvent.type === 'content_block_start') {
            const contentBlock = (messageStreamEvent as any).content_block;
            const blockIndex = (messageStreamEvent as any).index;
            if (contentBlock.type === 'tool_use' || contentBlock.type === 'server_tool_use') {
              // Check if we already have a temporary tool block for this index (race condition)
              const existingBlock = toolUseBlocks.find(block => block._blockIndex === blockIndex);
              
              if (existingBlock) {
                // Update the existing block with proper data from content_block_start
                existingBlock.id = contentBlock.id;
                existingBlock.name = contentBlock.name;
                existingBlock.type = contentBlock.type; // Preserve the server_tool_use vs tool_use type
                existingBlock.input = contentBlock.input || {};
                logger.info(`🔧 Updated existing ${contentBlock.type} block for index ${blockIndex}: ${existingBlock.name}`);
              } else {
                // Create new tool block (normal path)
                const toolBlock = {
                  ...contentBlock,
                  input: contentBlock.input || {},
                  _inputBuffer: '',
                  _blockIndex: blockIndex  // Track the original block index
                };
                
                toolUseBlocks.push(toolBlock);
                logger.info(`🔧 Added ${contentBlock.type}: ${toolBlock.name} (${toolUseBlocks.length} total)`);
              }
            } else if (contentBlock.type === 'thinking') {
              logger.info('🧠 Thinking block started');
            }
          } else if (messageStreamEvent.type === 'content_block_stop') {
            // Finalize tool input when block is complete
            const blockIndex = (messageStreamEvent as any).index;
            logger.info(`🏁 Block ${blockIndex} stopped`);
          
            // Find the correct tool block by _blockIndex
            let targetBlock = null;
            for (let i = 0; i < toolUseBlocks.length; i++) {
              if (i === blockIndex || toolUseBlocks[i]._blockIndex === blockIndex) {
                targetBlock = toolUseBlocks[i];
                break;
              }
            }
          
            if (targetBlock && targetBlock._inputBuffer) {
              logger.info(`🔧 Finalizing tool input for block ${blockIndex}, buffer:`, targetBlock._inputBuffer);
              try {
                targetBlock.input = JSON.parse(targetBlock._inputBuffer);
                logger.info(`✅ Parsed tool input:`, targetBlock.input);
                delete targetBlock._inputBuffer;
              } catch (error) {
                logger.error('❌ Failed to parse tool input JSON:', error);
                logger.error('🔍 Raw buffer content:', targetBlock._inputBuffer);
              }
            } else {
              logger.info(`ℹ️ No buffer to finalize for block ${blockIndex}`);
            }
        }
      }

      logger.info('🎯 Final tool use blocks:', JSON.stringify(toolUseBlocks, null, 2));

      // Process any tool use requests with proper feedback loop
      if (toolUseBlocks.length > 0) {
        return await this.executeToolsAndContinue(
          messages,
          textContent,
          toolUseBlocks,
          tools,
          systemPrompt
        );
      }

      return {
        content: textContent
      };

    } catch (error) {
      logger.error('Error generating Claude response:', error);
      throw new Error(`Failed to generate response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute tools and continue conversation until Claude provides final answer
   * This implements the LangGraph-style feedback loop for interleaved thinking
   */
  private async executeToolsAndContinue(
    originalMessages: Anthropic.MessageParam[],
    assistantText: string,
    toolUseBlocks: any[],
    tools: ExtendedTool[],
    systemPrompt: string,
    maxIterations: number = 5
  ): Promise<ClaudeResponse> {
    let currentMessages = [...originalMessages];
    let iteration = 0;

    // Build initial assistant message with text + tool calls
    const assistantContent: any[] = [];
    if (assistantText.trim()) {
      assistantContent.push({
        type: "text",
        text: assistantText
      });
    }

    // Add all tool use blocks
    for (const toolUse of toolUseBlocks) {
      assistantContent.push({
        type: "tool_use",
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input
      });
    }

    currentMessages.push({
      role: "assistant",
      content: assistantContent
    });

    while (iteration < maxIterations) {
      iteration++;
      logger.info(`🔄 Tool execution cycle ${iteration}/${maxIterations}`);
      logger.info(`🛠️ All tools in response:`, toolUseBlocks.map(t => `${t.name}(${JSON.stringify(t.input)})`));
      
      // Execute only client-side tools (server-side tools like web_search are handled by Anthropic)
      const clientSideTools = toolUseBlocks.filter(tool => tool.type !== 'server_tool_use');
      const serverSideTools = toolUseBlocks.filter(tool => tool.type === 'server_tool_use');
      
      if (serverSideTools.length > 0) {
        logger.info(`🌐 Server-side tools (handled by Anthropic):`, serverSideTools.map(t => `${t.name} (${t.type})`));
      }

      // If we only have server-side tools, exit the cycle - they're handled by Anthropic
      if (clientSideTools.length === 0) {
        logger.info(`✅ No client-side tools to execute, server tools handled by Anthropic`);
        // Return response with the assistant text (which includes server tool results)
        return {
          content: assistantText
        };
      }

      const toolResults: any[] = [];
      
      for (const toolUse of clientSideTools) {
        try {
          const result = await this.handleToolUse(toolUse);
          if (result !== null) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: result
            });
          }
        } catch (error) {
          logger.error(`Error executing tool ${toolUse.name}:`, error);
          toolResults.push({
            type: "tool_result", 
            tool_use_id: toolUse.id,
            content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }

      // Add tool results to conversation
      if (toolResults.length > 0) {
        logger.info(`📋 Tool results being sent to Claude:`);
        toolResults.forEach((r, i) => {
          logger.info(`  ${i+1}. ${r.tool_use_id}: ${typeof r.content === 'string' ? r.content.slice(0, 200) : JSON.stringify(r.content).slice(0, 200)}...`);
        });
        currentMessages.push({
          role: "user",
          content: toolResults
        });
      }

      // Continue conversation with Claude
      const streamParams: any = {
        model: CLAUDE_SETTINGS.model,
        max_tokens: CLAUDE_SETTINGS.maxTokens,
        temperature: CLAUDE_SETTINGS.temperature,
        system: systemPrompt,
        messages: currentMessages,
        stream: true,
        tools: tools.length > 0 ? tools as any : undefined
      };

      if (CLAUDE_SETTINGS.model.includes('claude-4')) {
        streamParams.thinking = {
          type: 'enabled',
          budget_tokens: Math.min(16000, CLAUDE_SETTINGS.maxTokens - 1000)
        };
      }

      const stream = await this.createMessageWithRetry(streamParams);

      // Process the continued response
      let newTextContent = '';
      let newToolUseBlocks: any[] = [];

      for await (const messageStreamEvent of stream) {
        if (messageStreamEvent.type === 'content_block_delta') {
          const delta = (messageStreamEvent as any).delta;
          const blockIndex = (messageStreamEvent as any).index;
          
          if (delta.type === 'text_delta') {
            newTextContent += delta.text;
          } else if (delta.type === 'thinking_delta') {
            logger.info(`🧠 Claude thinking (iteration ${iteration}): ${delta.thinking}`);
          } else if (delta.type === 'input_json_delta') {
            // Handle tool input parameters streaming in
            logger.info(`🔧 Tool input delta for iteration ${iteration}, block ${blockIndex}:`, JSON.stringify(delta));
            
            // Find the correct tool block
            let targetBlock = null;
            for (let i = 0; i < newToolUseBlocks.length; i++) {
              if (i === blockIndex || newToolUseBlocks[i]._blockIndex === blockIndex) {
                targetBlock = newToolUseBlocks[i];
                break;
              }
            }
            
            if (targetBlock && delta.partial_json) {
              if (!targetBlock.input) {
                targetBlock.input = {};
              }
              if (!targetBlock._inputBuffer) {
                targetBlock._inputBuffer = '';
              }
              targetBlock._inputBuffer += delta.partial_json;
              logger.info(`📦 Accumulated buffer for iteration ${iteration}, block ${blockIndex}:`, targetBlock._inputBuffer);
            }
          }
        } else if (messageStreamEvent.type === 'content_block_start') {
          const contentBlock = (messageStreamEvent as any).content_block;
          const blockIndex = (messageStreamEvent as any).index;
          if (contentBlock.type === 'tool_use') {
            const toolBlock = {
              ...contentBlock,
              input: contentBlock.input || {},
              _inputBuffer: '',
              _blockIndex: blockIndex
            };
            newToolUseBlocks.push(toolBlock);
            logger.info(`🔧 Added tool block for iteration ${iteration}, block ${blockIndex}: ${toolBlock.name} with input:`, JSON.stringify(toolBlock.input, null, 2));
          } else if (contentBlock.type === 'thinking') {
            logger.info(`🧠 Thinking block started (iteration ${iteration})`);
          }
        } else if (messageStreamEvent.type === 'content_block_stop') {
          const blockIndex = (messageStreamEvent as any).index;
          
          // Find and finalize tool input
          let targetBlock = null;
          for (let i = 0; i < newToolUseBlocks.length; i++) {
            if (i === blockIndex || newToolUseBlocks[i]._blockIndex === blockIndex) {
              targetBlock = newToolUseBlocks[i];
              break;
            }
          }
          
          if (targetBlock && targetBlock._inputBuffer) {
            logger.info(`🔧 Finalizing tool input for iteration ${iteration}, block ${blockIndex}, buffer:`, targetBlock._inputBuffer);
            try {
              targetBlock.input = JSON.parse(targetBlock._inputBuffer);
              logger.info(`✅ Parsed tool input for iteration ${iteration}:`, targetBlock.input);
              delete targetBlock._inputBuffer;
            } catch (error) {
              logger.error(`❌ Failed to parse tool input JSON for iteration ${iteration}:`, error);
            }
          }
        }
      }

      // If no more tool calls, we have the final answer
      if (newToolUseBlocks.length === 0) {
        logger.info(`✅ Final answer reached after ${iteration} iterations`);
        return {
          content: newTextContent
        };
      }

      // Otherwise, prepare for next iteration
      logger.info(`🔄 New tool calls for next iteration:`, JSON.stringify(newToolUseBlocks, null, 2));
      toolUseBlocks = newToolUseBlocks;
      
      // Add Claude's latest response to messages for next iteration
      const newAssistantContent: any[] = [];
      if (newTextContent.trim()) {
        newAssistantContent.push({
          type: "text",
          text: newTextContent
        });
      }
      for (const toolUse of newToolUseBlocks) {
        newAssistantContent.push({
          type: "tool_use",
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input
        });
      }
      
      currentMessages.push({
        role: "assistant",
        content: newAssistantContent
      });

      logger.info(`🔄 Continuing to iteration ${iteration + 1} with ${newToolUseBlocks.length} new tool calls`);
    }

    // Fallback if max iterations reached
    logger.warn(`⚠️ Reached max iterations (${maxIterations}), returning partial response`);
    return {
      content: "I encountered an issue while processing your request. Please try asking again."
    };
  }

  /**
   * Build message history for Anthropic API from smart context with clean separation
   */
  private buildMessageHistoryFromSmartContext(
    smartContext?: { 
      recentMessages: any[];
      contextDocuments?: any[]; // Documents from context deduplication
    },
    currentPrompt?: string // Current user message text only
  ): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];

    // Add context documents as a separate message at the beginning (if any)
    if (smartContext?.contextDocuments && smartContext.contextDocuments.length > 0) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Context documents from conversation history:'
          },
          ...smartContext.contextDocuments
        ]
      });
      logger.info(`📎 Added ${smartContext.contextDocuments.length} context documents as separate message`);
    }

    // Convert recent messages from smart context to Anthropic format
    if (smartContext?.recentMessages) {
      for (const msg of smartContext.recentMessages) {
        // Skip system messages and empty messages
        if (!msg.content || msg.content.trim() === '') continue;
        
        let role: 'user' | 'assistant' = 'user';
        let content: string = msg.content;
        
        // Check if it's Claude's message (bot messages)
        if (msg.author?.bot && msg.author?.id === this.threadContext.discordClient?.user?.id) {
          role = 'assistant';
        } else {
          // For user messages in servers, include author name for context
          if (msg.guild && msg.author?.displayName) {
            content = `${msg.author.displayName}: ${content}`;
          }
        }
        
        messages.push({
          role,
          content
        });
      }
    }

    // Add current prompt if provided (pure text only)
    if (currentPrompt) {
      messages.push({
        role: 'user',
        content: currentPrompt
      });
    }

    return messages;
  }

  /**
   * Check if the model supports web search
   */
  private supportsWebSearch(): boolean {
    const webSearchModels = [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022', 
      'claude-sonnet-4-20250514',
      'claude-3-7-sonnet-latest'
    ];
    return webSearchModels.includes(CLAUDE_SETTINGS.model);
  }

  /**
   * Create message with retry logic for overload errors
   */
  private async createMessageWithRetry(params: any, maxRetries: number = 3): Promise<any> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🔄 Attempt ${attempt}/${maxRetries} to create message with Claude...`);
        return await this.anthropic.messages.create(params) as any;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's an overload error
        if (error?.error?.type === 'overloaded_error' || error?.message?.includes('Overloaded')) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
          logger.warn(`⚠️ Claude API overloaded (attempt ${attempt}/${maxRetries}), retrying in ${waitTime}ms...`);
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        } else {
          // Non-overload error, don't retry
          logger.error(`❌ Non-retryable error on attempt ${attempt}:`, error);
          throw error;
        }
      }
    }
    
         // All retries exhausted
     logger.error(`❌ All ${maxRetries} attempts failed, throwing final error`);
     throw lastError;
   }

   /**
    * Count tokens with retry logic
    */
   private async countTokensWithRetry(params: any, maxRetries: number = 3): Promise<any> {
     let lastError: any;
     
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
       try {
         return await this.anthropic.messages.countTokens(params);
       } catch (error: any) {
         lastError = error;
         
         if (error?.error?.type === 'overloaded_error' || error?.message?.includes('Overloaded')) {
           const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Faster backoff for token counting
           logger.warn(`⚠️ Token counting API overloaded (attempt ${attempt}/${maxRetries}), retrying in ${waitTime}ms...`);
           
           if (attempt < maxRetries) {
             await new Promise(resolve => setTimeout(resolve, waitTime));
             continue;
           }
         } else {
           throw error;
         }
       }
     }
     
     throw lastError;
   }

  /**
   * Handle tool use requests
   */
  private async handleToolUse(toolUse: any): Promise<string | null> {
    try {
      logger.info('Tool use request:', JSON.stringify(toolUse, null, 2));
      
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
   * Handle thread creation tool
   */
  private async handleCreateThread(input: any): Promise<string> {
    if (!this.threadContext.currentChannel || !this.threadContext.discordClient) {
      throw new Error('Discord context not available for thread creation');
    }

    logger.info('Thread creation input:', JSON.stringify(input, null, 2));

    const { name, purpose, initial_message, use_current_message = false } = input;

    logger.info('Extracted parameters:', { name, purpose, initial_message, use_current_message });

    if (!name || !purpose || !initial_message) {
      const missing = [];
      if (!name) missing.push('name');
      if (!purpose) missing.push('purpose');
      if (!initial_message) missing.push('initial_message');
      throw new Error(`Missing required parameters for thread creation: ${missing.join(', ')}`);
    }

    try {
      let thread;
      
      if (use_current_message && this.threadContext.currentMessage) {
        // Create thread from current message
        thread = await this.threadContext.currentMessage.startThread({
          name: name,
          autoArchiveDuration: 1440, // 24 hours
          reason: `Thread created by Claude for: ${purpose}`
        });
      } else {
        // Create standalone thread - check if we're in a thread and use parent channel
        const targetChannel = this.threadContext.currentChannel.isThread() 
          ? this.threadContext.currentChannel.parent 
          : this.threadContext.currentChannel;
        
        if (!targetChannel) {
          throw new Error('Cannot create thread: No valid channel found');
        }
        
        thread = await targetChannel.threads.create({
          name: name,
          autoArchiveDuration: 1440, // 24 hours
          reason: `Thread created by Claude for: ${purpose}`
        });
      }

      // Send initial message to thread
      await thread.send(initial_message);

      return `✅ **Thread Created Successfully!**\n\n**Thread:** ${thread.toString()}\n**Purpose:** ${purpose}\n\nI've posted the initial message there. Click the thread link above to continue the discussion!`;

    } catch (error) {
      throw new Error(`Failed to create thread: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

     /**
    * Handle list threads tool
    */
   private async handleListThreads(input: any): Promise<string> {
    if (!this.threadContext.currentChannel || !this.threadContext.discordClient) {
      throw new Error('Discord context not available for listing threads');
    }

    const { include_archived = false } = input;

    try {
      // Get the channel (could be main channel or we could be in a thread)
      let parentChannel = this.threadContext.currentChannel;
      
      // If we're in a thread, get the parent channel
      if (this.threadContext.currentChannel.isThread?.()) {
        parentChannel = this.threadContext.currentChannel.parent!;
      }

      // Fetch all threads in the channel
      const threads = await parentChannel.threads.fetch({ archived: include_archived });
      
      if (threads.threads.size === 0) {
        return "No threads found in this channel.";
      }

      // Format thread list
      const threadList = threads.threads.map((thread: any) => {
        const isArchived = thread.archived ? " (archived)" : "";
        const memberCount = thread.memberCount ? ` - ${thread.memberCount} members` : "";
        const lastActivity = thread.lastMessageId ? ` - Last activity: <t:${Math.floor(thread.createdTimestamp / 1000)}:R>` : "";
        
        return `• **${thread.name}** (ID: ${thread.id})${isArchived}${memberCount}${lastActivity}`;
      }).join('\n');

      const threadIds = threads.threads.map((thread: any) => thread.id);
      
      return `**Available Threads in #${parentChannel.name}:**\n\n${threadList}\n\n**Thread IDs:** ${threadIds.join(', ')}\n\n**CRITICAL**: To read any thread, call get_thread_context with the thread_id parameter. Extract the ID from parentheses above or use one of these exact IDs: ${threadIds.join(', ')}`;

    } catch (error) {
      logger.error('Error listing threads:', error);
      throw new Error(`Failed to list threads: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  

   /**
    * Handle thread context query tool - uses delegate Claude for focused answers
    */
   private async handleQueryThreadContext(input: any): Promise<string> {
     const { thread_id, query, context_hint } = input;

     if (!thread_id) {
       throw new Error('Thread ID is required for query_thread_context. You MUST call list_threads first to see available threads and get their IDs, then use query_thread_context with a specific thread_id.');
     }

     if (!query) {
       throw new Error('A query is required for query_thread_context. Be precise about what information you\'re looking for.');
     }

     if (!this.threadQueryService) {
       throw new Error('Thread query service not initialized. Discord context must be set first.');
     }

     try {
       logger.info(`🎯 Processing thread query: "${query}" for thread ${thread_id}`);
       
       // Use the ThreadQueryService to get a focused answer
       const result = await this.threadQueryService.queryThreadContext(thread_id, query, context_hint);
       
       // Format the response for the main Claude
       return `🧵 **Thread Query Result**

**Thread:** ${result.threadName}
**Query:** "${query}"
${context_hint ? `**Context:** ${context_hint}` : ''}

**Answer:**
${result.answer}

**Source Info:**
- 📊 Analyzed ${result.sourceMessageCount} messages
- 📎 ${result.hasDocuments ? 'Included document analysis' : 'No documents found'}
- 🔢 Used ${result.tokenUsage.input} input + ${result.tokenUsage.output} output tokens

*This response was generated by a specialized Claude instance with full thread context to avoid polluting your conversation context.*`;

     } catch (error) {
       logger.error('❌ Error in handleQueryThreadContext:', error);
       throw new Error(`Failed to query thread context: ${error instanceof Error ? error.message : 'Unknown error'}`);
     }
   }

   /**
    * Get recent conversation context for thread handoff
    */
   private async getRecentConversationContext(): Promise<Anthropic.MessageParam[]> {
     if (!this.threadContext.currentChannel) {
       logger.warn('No current channel available for thread handoff');
       return [];
     }

     try {
       // Fetch recent Discord message history directly
       const messages = await this.threadContext.currentChannel.messages.fetch({ limit: 10 });
       
       // Sort messages by creation time (oldest first)
       const sortedMessages = Array.from(messages.values())
         .sort((a: any, b: any) => a.createdTimestamp - b.createdTimestamp);
       
       const contextMessages: Anthropic.MessageParam[] = [];
       
       for (const msg of sortedMessages) {
         const discordMsg = msg as any; // Type assertion for Discord message
         // Skip system messages
         if (discordMsg.system) continue;
         
         let role: 'user' | 'assistant' = 'user';
         let content = discordMsg.content;
         
         // Check if it's Claude's message
         if (discordMsg.author.bot && discordMsg.author.id === this.threadContext.discordClient?.user?.id) {
           role = 'assistant';
         } else {
           // For user messages, include author name in multi-user channels
           if (discordMsg.guild) {
             content = `${discordMsg.author.displayName}: ${content}`;
           }
         }
         
         // Only include messages with content
         if (content.trim()) {
           contextMessages.push({
             role,
             content
           });
         }
       }

       logger.info(`📋 Prepared ${contextMessages.length} context messages for thread handoff`);
       return contextMessages;
     } catch (error) {
       logger.error('Error getting conversation context for thread handoff:', error);
       return [];
     }
   }

   /**
   * Check if Claude API is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.anthropic.messages.create({
        model: CLAUDE_SETTINGS.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
        system: 'Respond with just "pong"'
      });

      const responseText = result.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('')
        .toLowerCase();

      return responseText.includes('pong');
    } catch (error) {
      logger.error('Claude health check failed:', error);
      return false;
    }
  }

  /**
   * Build smart context with summaries and recent messages
   */
  async buildContextWithSummaries(
    channel: any,
    strategy: 'fixed' | 'adaptive' | 'unlimited' = CONTEXT_MANAGEMENT.STRATEGY,
    requestedLimit?: number,
    currentMessage?: Message,
    attachmentProcessor?: (message: Message, existingAttachments: any[], messageLimit: number) => Promise<any[]>
  ): Promise<{ 
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
  }> {
    return await buildContextWithSummaries(channel, strategy, requestedLimit, currentMessage, attachmentProcessor);
  }

  /**
   * Get messages for context using adaptive strategy
   */
  async getMessagesForContext(
    channel: any,
    strategy: 'fixed' | 'adaptive' | 'unlimited' = CONTEXT_MANAGEMENT.STRATEGY,
    requestedLimit?: number
  ): Promise<{ messages: any[], hasMoreHistory: boolean, strategy: string }> {
    return await getMessagesForContext(channel, strategy, requestedLimit);
  }

  // Removed token counting and system prompt methods - functionality integrated into generateResponse
}

export const claudeService = new ClaudeService(); 