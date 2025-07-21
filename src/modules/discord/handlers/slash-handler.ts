import { 
  ChatInputCommandInteraction,
  Client
} from 'discord.js';
import { logger } from '../../infra/logging';
import { rateLimitService } from '../../infra/rate-limiting';
import { MessageSplitter } from '../formatters/message-splitter';
import { AttachmentManager } from '../../files/attachment-manager';
import { ContextService } from '../../data/context-service';
import { AIService } from '../types';

/**
 * Slash Command Handler
 * Processes Discord slash command interactions
 */
export class SlashHandler {
  private client: Client;
  private messageSplitter: MessageSplitter;
  private attachmentManager: AttachmentManager;
  private contextService: ContextService;
  private aiService?: AIService;

  constructor(
    client: Client, 
    messageSplitter: MessageSplitter,
    attachmentManager: AttachmentManager,
    contextService: ContextService,
    aiService?: AIService
  ) {
    this.client = client;
    this.messageSplitter = messageSplitter;
    this.attachmentManager = attachmentManager;
    this.contextService = contextService;
    this.aiService = aiService;
  }

  /**
   * Set AI service for dependency injection
   */
  setAIService(aiService: AIService): void {
    this.aiService = aiService;
  }

  /**
   * Handle slash command interactions (for user app support)
   */
  async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // Check rate limiting
      const rateLimitInfo = await rateLimitService.checkClaudeLimit(interaction.user.id);
      if (rateLimitInfo.isLimited) {
        const resetTime = Math.round(rateLimitInfo.resetTime.getTime() / 1000);
        await interaction.reply({ 
          content: `⏰ You're asking me questions too quickly! Please wait until <t:${resetTime}:R>.`,
          ephemeral: true 
        });
        return;
      }

      // Defer reply to give us time to process
      await interaction.deferReply();

      const commandName = interaction.commandName;
      
      // Extract prompt from command
      if (commandName !== 'claude') {
        await interaction.editReply('❌ Unknown command.');
        return;
      }
      
      const prompt = interaction.options.getString('message', true);

      await this.processAIRequest(interaction, prompt);

    } catch (error) {
      logger.error(`Error processing slash command from ${interaction.user.tag}:`, error);
      
      const errorMessage = '❌ Sorry, I encountered an error processing your request. Please try again.';
      
      if (interaction.deferred) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }

  /**
   * Process AI request with dependency-injected AI service
   */
  private async processAIRequest(interaction: ChatInputCommandInteraction, prompt: string): Promise<void> {
    if (!this.aiService) {
      logger.error('No AI service configured for slash command processing');
      await interaction.editReply('❌ AI service not available. Please try again later.');
      return;
    }

    // Start thinking indicator
    await interaction.followUp({ content: '⌨️ *Claude is thinking...*' }).then(msg => {
      // Delete the typing indicator after a short delay
      setTimeout(() => msg.delete().catch(() => {}), 2000);
    });

    logger.info('🧠 Processing slash command AI request with smart context...');
    
    try {
      // Use injected ContextService instead of importing from old services
      let smartContext;
      if (interaction.channel && 'messages' in interaction.channel) {
        smartContext = await this.contextService.buildContextWithSummaries(
          interaction.channel as any,
          'adaptive', // Use adaptive strategy
          undefined,  // No specific limit
          undefined,  // No current message for slash commands
          // No attachment processing for slash commands currently
          undefined
        );
        
        logger.info(`📊 Smart context built: ${smartContext.recentMessages.length} messages, ${smartContext.contextDocuments.length} documents, ${smartContext.totalTokenEstimate} tokens`);
      } else {
        // Fallback for channels without message history access
        smartContext = {
          summaryContext: '',
          recentMessages: [],
          contextDocuments: [],
          totalTokenEstimate: 0,
          hasMoreHistory: false,
          strategy: 'fallback',
          tokenBreakdown: {
            summaryTokens: 0,
            messageTokens: 0,
            documentTokens: 0,
            systemTokens: 1000,
            availableForResponse: 4000
          }
        };
      }

      // Generate AI response using full smart context (including repository data)
      const response = this.aiService.processWithSmartContext 
        ? await this.aiService.processWithSmartContext(prompt, smartContext)
        : await this.aiService.processConversation(
            prompt,
            smartContext.recentMessages.map(msg => ({
              role: msg.author?.bot ? 'assistant' : 'user',
              content: msg.content,
              author: msg.author?.displayName || msg.author?.username
            })),
            smartContext.contextDocuments
          );

      // Send response (split if too long)
      await this.sendLongSlashResponse(interaction, response);
    } catch (error) {
      logger.error('Error processing slash command AI request:', error);
      throw error;
    }
  }

  /**
   * Send long slash response with automatic splitting
   */
  private async sendLongSlashResponse(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    const chunks = this.messageSplitter.splitMessage(content);
    
    // Send first chunk as edit to the deferred reply
    if (chunks.length > 0) {
      await interaction.editReply(chunks[0]);
    }
    
    // Send remaining chunks as follow-ups
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  }
} 