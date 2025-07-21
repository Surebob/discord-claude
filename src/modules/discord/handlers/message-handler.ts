import { 
  Message, 
  TextChannel, 
  DMChannel, 
  NewsChannel, 
  ThreadChannel,
  Client
} from 'discord.js';
import { logger, discordLogger } from '../../infra/logging';
import { config } from '../../infra/config';
import { rateLimitService } from '../../infra/rate-limiting';
import { MessageSplitter } from '../formatters/message-splitter';
import { AttachmentManager } from '../../files/attachment-manager';
import { ContextService } from '../../data/context-service';
import { AIService } from '../types';

/**
 * Message Handler
 * Processes Discord message events and handles mention detection
 */
export class MessageHandler {
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
   * Handle regular messages for mention detection  
   * NOTE: User apps cannot receive regular message events in DMs
   * This only works for server messages where the bot is mentioned
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      // Only respond to mentions if enabled
      if (!config.enableMentionResponses) return;

      // Check if bot is mentioned
      const botMention = `<@${this.client.user?.id}>`;
      if (!message.content.includes(botMention)) return;

      // Extract the prompt (remove bot mention)
      const prompt = message.content.replace(botMention, '').trim();
      if (!prompt) return;

      discordLogger.mention(message.author.id, message.channelId, message.guildId || undefined);

      // Check rate limits
      const rateLimitInfo = await rateLimitService.checkClaudeLimit(message.author.id);
      if (rateLimitInfo.isLimited) {
        const resetTime = Math.round(rateLimitInfo.resetTime.getTime() / 1000);
        await message.reply(`⏰ You're asking me questions too quickly! Please wait until <t:${resetTime}:R>.`);
        return;
      }

      await this.processAIRequest(message, prompt);

    } catch (error) {
      logger.error('Error handling mention:', error);
      await message.reply('❌ Sorry, I encountered an error while processing your message. Please try again later.');
      await message.react('❌');
    }
  }

  /**
   * Process AI request with dependency-injected AI service
   */
  private async processAIRequest(message: Message, prompt: string): Promise<void> {
    if (!this.aiService) {
      logger.error('No AI service configured for message processing');
      await message.reply('❌ AI service not available. Please try again later.');
      return;
    }

    // Start typing indicator immediately
    await (message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel).sendTyping();
    
    // Keep typing indicator alive during long operations
    const typingInterval = setInterval(() => {
      (message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel).sendTyping().catch(() => {});
    }, 5000); // Refresh every 5 seconds

    try {
      logger.info('🧠 Processing AI request with smart context...');
      
      // Use injected ContextService instead of importing from old services
      const smartContext = await this.contextService.buildContextWithSummaries(
        message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel,
        'adaptive', // Use adaptive strategy
        undefined,  // No specific limit
        message,    // Current message for attachment processing
        (msg: Message, existingAttachments: any[], messageLimit: number) => 
          this.attachmentManager.processAttachmentsWithDeduplication(msg, messageLimit)
      );

      logger.info(`📊 Smart context built: ${smartContext.recentMessages.length} messages, ${smartContext.contextDocuments.length} documents, ${smartContext.totalTokenEstimate} tokens`);

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
      
      // Stop typing indicator
      clearInterval(typingInterval);

      // Send response (split if too long)
      await this.sendLongMessage(message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel, response);

      discordLogger.messageProcessed(message.id, message.author.id, message.channelId, Date.now() - message.createdTimestamp);

    } catch (error) {
      // Stop typing indicator on error
      clearInterval(typingInterval);
      logger.error('Error processing AI request:', error);
      throw error;
    }
  }

  /**
   * Process attachments with smart deduplication across message history
   */
  private async processAttachmentsWithDeduplication(
    message: Message, 
    _unusedParam?: any[], // Keep parameter for compatibility but don't use it
    messageLimit?: number // Add message limit parameter
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }>> {
    return await this.attachmentManager.processAttachmentsWithDeduplication(message, messageLimit);
  }

  /**
   * Send long message with automatic splitting
   */
  private async sendLongMessage(
    channel: TextChannel | DMChannel | NewsChannel | ThreadChannel, 
    content: string
  ): Promise<void> {
    const chunks = this.messageSplitter.splitMessage(content);
    
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }
} 