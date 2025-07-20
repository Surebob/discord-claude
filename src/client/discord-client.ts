import { 
  Client, 
  GatewayIntentBits, 
  Partials,
  Events,
  ActivityType,
  Message,
  Attachment,
  TextChannel,
  DMChannel,
  NewsChannel,
  ThreadChannel,
  ChatInputCommandInteraction,
  ChannelType
} from 'discord.js';
import { config } from '@/config/index.js';
import { MessageHistory } from '@/types/index.js';
import { logger, startupLogger, discordLogger } from '@/utils/logger.js';
import { rateLimitService } from '@/utils/rate-limiter.js';
import { claudeService } from '@/services/claude.js';
// Removed threadManager - using Discord API directly

class DiscordClientManager {
  public client: Client;
  private isShuttingDown = false;

  constructor() {
    // Initialize Discord client with required intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
      ],
      partials: [
        Partials.Channel, // Required for DM support
        Partials.Message
      ]
    });

    this.setupEventHandlers();
    this.setupProcessHandlers();
    
    // Discord client setup complete
  }

  /**
   * Set up Discord event handlers
   */
  private setupEventHandlers(): void {
    // Bot ready event
    this.client.once(Events.ClientReady, async (readyClient) => {
      startupLogger.ready(config.botName, readyClient.guilds.cache.size);
      
      // Set bot activity
      readyClient.user.setActivity({
        name: `${config.botName} | Ready to help!`,
        type: ActivityType.Custom
      });

      // Health check for Claude
      try {
        const isHealthy = await claudeService.healthCheck();
        if (!isHealthy) {
          logger.warn('⚠️ Claude health check failed - API may be unavailable');
        } else {
          logger.info('✅ Claude API health check passed');
        }
      } catch (error) {
        logger.error('❌ Claude health check error:', error);
      }
    });

    // Handle slash commands (for user app support)
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    // Handle messages (for mention detection in servers)
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      await this.handleMessage(message);
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      discordLogger.error(error);
    });

    // Warning handling
    this.client.on(Events.Warn, (warning) => {
      logger.warn(`Discord warning: ${warning}`);
    });

    // Debug logging (only in development)
    if (process.env.NODE_ENV === 'development') {
      this.client.on(Events.Debug, (info) => {
        logger.debug(info);
      });
    }
  }



  /**
   * Handle regular messages for mention detection  
   * NOTE: User apps cannot receive regular message events in DMs
   * This only works for server messages where the bot is mentioned
   */
  private async handleMessage(message: Message): Promise<void> {
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

    // Show typing indicator
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    try {
      // Set Discord context for Claude's thread operations
      claudeService.setThreadContext({
        discordClient: this.client,
        currentChannel: message.channel,
        currentMessage: message
      }, (msg, attachments, limit) => this.processAttachmentsWithDeduplication(msg, attachments, limit));

      // Current message is pure text only - attachments will be handled in context
      const finalPrompt = prompt;

      // Start typing indicator immediately
      await (message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel).sendTyping();
      
      // Keep typing indicator alive during long operations
      const typingInterval = setInterval(() => {
        (message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel).sendTyping().catch(() => {});
      }, 5000); // Refresh every 5 seconds

      try {
        // BUILD SMART CONTEXT WITH ADAPTIVE STRATEGY INCLUDING DOCUMENTS
        logger.info('🧠 Building adaptive context for Claude...');
        
        const context = await claudeService.buildContextWithSummaries(
          message.channel,
          'adaptive', // Use adaptive strategy
          undefined, // No requested limit
          message, // Pass current message for attachment processing
          (msg, attachments, limit) => this.processAttachmentsWithDeduplication(msg, attachments, limit) // Pass attachment processor with limit
        );
        
        // Context summary already logged in buildContextWithSummaries
        
        // Check if we need summarization
        const usagePercent = (context.totalTokenEstimate / 200000) * 100;
        
        if (usagePercent > 80) {
          logger.warn(`⚠️ High token usage: ${usagePercent.toFixed(1)}% of context window`);
          logger.warn(`🔔 Consider summarization after this response`);
          // TODO: Implement summarization workflow
        } else {
          logger.info(`✅ Token usage healthy: ${usagePercent.toFixed(1)}% of context window`);
        }
        
        // Generate Claude response with smart context and web search enabled
        const response = await claudeService.generateResponse(
          finalPrompt,
          context, // Use smart context instead of old message history
          true // Enable web search
        );
        
        // Stop typing indicator
        clearInterval(typingInterval);

        // Send response (split if too long) - Discord itself stores the message history
        await this.sendLongMessage(message.channel as TextChannel | DMChannel | NewsChannel | ThreadChannel, response.content);
      } catch (error) {
        // Stop typing indicator on error
        clearInterval(typingInterval);
        throw error;
      }

    } catch (error) {
      logger.error('Error handling mention:', error);
      await message.reply('❌ Sorry, I encountered an error while processing your message. Please try again later.');
      await message.react('❌');
    }
  }

  /**
   * Handle slash command interactions (for user app support)
   */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // We'll set the context after we get it - need to move this down

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

      // Set Discord context for Claude's thread operations
      claudeService.setThreadContext({
        discordClient: this.client,
        currentChannel: interaction.channel,
        currentMessage: null // Slash commands don't have a specific message
      }, (msg, attachments, limit) => this.processAttachmentsWithDeduplication(msg, attachments, limit));

      // Start typing indicator immediately
      await interaction.followUp({ content: '⌨️ *Claude is thinking...*' }).then(msg => {
        // Delete the typing indicator after a short delay
        setTimeout(() => msg.delete().catch(() => {}), 2000);
      });

      // BUILD SMART CONTEXT FOR SLASH COMMAND
      logger.info('🧠 Building adaptive context for slash command...');
      
      const context = await claudeService.buildContextWithSummaries(
        interaction.channel!,
        'adaptive'
      );
      
      logger.info(`📊 Slash command context: ${context.strategy} strategy`);
      logger.info(`🔢 Token usage: ${context.totalTokenEstimate} tokens (${((context.totalTokenEstimate / 200000) * 100).toFixed(1)}%)`);
      
      if ((context.totalTokenEstimate / 200000) > 0.8) {
        logger.warn(`⚠️ SLASH COMMAND: High token usage, consider summarization`);
        // TODO: Implement summarization workflow
      }

      // Generate Claude response with smart context and web search enabled
      const response = await claudeService.generateResponse(
        prompt,
        context, // Use smart context instead of old message history
        true // Enable web search
      );

      // Send response (split if too long) - Discord itself stores the message history
      await this.sendLongSlashResponse(interaction, response.content);

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

  // Removed getChannelHistory - replaced with smart context system

  /**
   * Process attachments with smart deduplication across message history
   */
  private async processAttachmentsWithDeduplication(
    message: Message, 
    _unusedParam?: any[], // Keep parameter for compatibility but don't use it
    messageLimit?: number // Add message limit parameter
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }>> {
    const claudeContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }> = [];
    
    // Step 1: Collect ALL attachments from current message + recent history
    const allAttachments: { attachment: any; messageId: string; timestamp: number; isCurrentMessage: boolean }[] = [];
    
    // Add current message attachments (highest priority)
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        allAttachments.push({
          attachment,
          messageId: message.id,
          timestamp: message.createdTimestamp,
          isCurrentMessage: true
        });
        logger.info(`📎 Current message attachment: ${attachment.name} (${attachment.size} bytes)`);
      }
    }
    
    // Add recent message history attachments - using the SAME data source as messageHistory
    try {
      const limit = messageLimit || 21; // Use provided limit or default to 21
      const recentMessages = await message.channel.messages.fetch({ limit });
      logger.info(`🔍 Fetched ${recentMessages.size} messages for attachment scanning (limit: ${limit})`);
      
      let messagesWithAttachments = 0;
      for (const [, msg] of recentMessages) {
        if (msg.id !== message.id && msg.attachments.size > 0) {
          messagesWithAttachments++;
          for (const attachment of msg.attachments.values()) {
            allAttachments.push({
              attachment,
              messageId: msg.id,
              timestamp: msg.createdTimestamp,
              isCurrentMessage: false
            });
            logger.info(`📎 Found: ${attachment.name} (${attachment.size} bytes) from ${msg.id}`);
          }
        }
      }
      logger.info(`📊 Attachment scan: ${messagesWithAttachments} messages with attachments, ${recentMessages.size - messagesWithAttachments - 1} without`);
    } catch (error) {
      logger.warn('Could not fetch recent messages for attachment deduplication:', error);
    }
    
    // Step 2: Deduplicate by filename + size, keeping the newest
    logger.info(`🧮 Deduplicating ${allAttachments.length} total attachments...`);
    const fileMap = new Map<string, { attachment: any; messageId: string; timestamp: number; isCurrentMessage: boolean }>();
    
    let duplicatesSkipped = 0;
    for (const item of allAttachments) {
      const key = `${item.attachment.name}_${item.attachment.size}`;
      const existing = fileMap.get(key);
      
      if (!existing) {
        fileMap.set(key, item);
      } else {
        duplicatesSkipped++;
        // Keep the newer one (current message always wins, then by timestamp)
        if (item.isCurrentMessage && !existing.isCurrentMessage) {
          fileMap.set(key, item);
          logger.info(`🔄 Replaced ${existing.attachment.name} with current message version`);
        } else if (!item.isCurrentMessage && !existing.isCurrentMessage && item.timestamp > existing.timestamp) {
          fileMap.set(key, item);
          logger.info(`🔄 Replaced ${existing.attachment.name} with newer version`);
        }
      }
    }
    
    // Step 3: Process the deduplicated files
    logger.info(`📋 Deduplication result: ${fileMap.size} unique files (${duplicatesSkipped} duplicates removed)`);
    for (const [, { attachment }] of fileMap.entries()) {
      const claudeAttachment = await this.createClaudeAttachment(attachment);
      if (claudeAttachment) {
        claudeContent.push(claudeAttachment);
        logger.info(`✅ Processed: ${attachment.name} → ${claudeAttachment.type} content`);
      } else {
        logger.warn(`❌ Unsupported file type: ${attachment.name}`);
      }
    }
    
    logger.info(`🎯 Context documents ready: ${claudeContent.length} files for Claude`);
    return claudeContent;
  }

  /**
   * Legacy method - kept for compatibility but now unused
   */
  private async processAttachments(message: Message): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }>> {
    const claudeContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }> = [];
    
    // Check current message for attachments
    logger.info(`🔍 Current message has ${message.attachments.size} attachments`);
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        logger.info(`📎 Processing attachment: ${attachment.name} (${attachment.size} bytes, ${attachment.contentType})`);
        const claudeAttachment = await this.createClaudeAttachment(attachment);
        if (claudeAttachment) {
          logger.info(`✅ Successfully processed attachment for Claude`);
          claudeContent.push(claudeAttachment);
        } else {
          logger.info(`❌ Skipped attachment (unsupported or too large)`);
        }
      }
    }

    // Note: We only process attachments from the current message
    // Attachments from message history are already included via Discord's message content
    // when they're text files (like .md) or when users reference them directly

    return claudeContent;
  }

  /**
   * Create Claude-compatible attachment content
   */
  private async createClaudeAttachment(attachment: Attachment, sourceMessage?: Message): Promise<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown } | null> {
    const maxFileSize = 32 * 1024 * 1024; // 32MB (Claude's limit)
    
    if (attachment.size > maxFileSize) {
      logger.warn(`File ${attachment.name} too large (${attachment.size} bytes) - Claude max is 32MB`);
      return null;
    }

    const fileType = this.getClaudeFileType(attachment.name, attachment.contentType || undefined);
    
    if (!fileType) {
      logger.warn(`Unsupported file type for Claude: ${attachment.contentType || 'unknown'} (${attachment.name})`);
      return null;
    }

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        logger.warn(`Failed to fetch attachment: ${response.status}`);
        return null;
      }

      if (fileType === 'image') {
        // For images, use Claude's native image processing
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.contentType,
            data: base64
          }
        };
      } else if (fileType === 'document') {
        // For PDFs only - use Claude's native document processing
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf', // Only PDFs supported for document type
            data: base64
          }
        };
      } else if (fileType === 'text') {
        // For text files - use text content type (Claude API change)
        const text = await response.text();
        
        return {
          type: 'text',
          text: `**${attachment.name}:**\n\n${text}`
        };
      }

      return null;

    } catch (error) {
      logger.error(`Error processing attachment ${attachment.name}:`, error);
      return null;
    }
  }

  /**
   * Determine if file type is supported by Claude natively
   */
  private getClaudeFileType(filename: string, contentType?: string): 'image' | 'document' | 'text' | null {
    const ext = filename.toLowerCase().split('.').pop();
    
    // Images - Claude native support
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '') || contentType?.startsWith('image/')) {
      return 'image';
    }
    
    // Documents - Claude native support (PDFs only)
    if (['pdf'].includes(ext || '') || contentType === 'application/pdf') {
      return 'document';
    }
    
    // Text documents - Use text content type instead of document
    if (['txt', 'md', 'markdown', 'json', 'html', 'rtf'].includes(ext || '') || contentType?.startsWith('text/')) {
      return 'text';
    }
    
    return null;
  }

  /**
   * Send a long message, splitting if necessary
   */
  private async sendLongMessage(channel: TextChannel | DMChannel | NewsChannel | ThreadChannel, content: string): Promise<void> {
    const maxLength = 2000;
    
    if (content.length <= maxLength) {
      await channel.send(content);
      return;
    }

    // Split by paragraphs first, then by sentences, then by characters
    const chunks = this.splitMessage(content, maxLength);
    
    for (const chunk of chunks) {
      await channel.send(chunk);
      // Minimal delay - bot is unrestricted
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  /**
   * Send long response via slash command interaction
   */
  private async sendLongSlashResponse(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    const maxLength = 2000;
    
    if (content.length <= maxLength) {
      await interaction.editReply(content);
      return;
    }

    // Split by paragraphs first, then by sentences, then by characters
    const chunks = this.splitMessage(content, maxLength);
    
    // Send first chunk as edit to deferred reply
    await interaction.editReply(chunks[0]);
    
    // Send remaining chunks as follow-ups
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
      // Minimal delay - bot is unrestricted
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  /**
   * Split message intelligently
   */
  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let chunk = remaining.substring(0, maxLength);
      
      // Try to break at paragraph
      let breakIndex = chunk.lastIndexOf('\n\n');
      if (breakIndex === -1) {
        // Try to break at sentence
        breakIndex = chunk.lastIndexOf('. ');
        if (breakIndex !== -1) breakIndex += 2;
      }
      if (breakIndex === -1) {
        // Try to break at word
        breakIndex = chunk.lastIndexOf(' ');
      }
      if (breakIndex === -1) {
        // Force break
        breakIndex = maxLength;
      }

      chunk = remaining.substring(0, breakIndex);
      chunks.push(chunk);
      remaining = remaining.substring(breakIndex).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Set up process handlers for graceful shutdown
   */
  private setupProcessHandlers(): void {
    const gracefulShutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      startupLogger.shutdown(config.botName);
      logger.info(`Received ${signal}, shutting down gracefully...`);

      try {
        // Clean up resources
        this.client.destroy();
        
        // Give time for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });
  }

  /**
   * Login to Discord
   */
  async login(): Promise<void> {
    startupLogger.init(config.botName);
    
    try {
      await this.client.login(config.token);
    } catch (error) {
      logger.error('Failed to login to Discord:', error);
      throw error;
    }
  }
}

export const discordClient = new DiscordClientManager(); 