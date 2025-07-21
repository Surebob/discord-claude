import { 
  Client, 
  GatewayIntentBits, 
  Partials,
  Events,
  ActivityType,
  Message,
  ChatInputCommandInteraction
} from 'discord.js';
import { logger, startupLogger, discordLogger } from '../infra/logging';
import { config } from '../infra/config';
import { MessageHandler } from './handlers/message-handler';
import { SlashHandler } from './handlers/slash-handler';
import { ThreadHandler } from './handlers/thread-handler';
import { MessageSplitter } from './formatters/message-splitter';
import { AttachmentManager } from '../files/attachment-manager';
import { ContextService } from '../data/context-service';
import { AIService } from './types';

/**
 * Discord Client Manager
 * Core Discord API integration and lifecycle management
 */
export class DiscordClient {
  public client: Client;
  private isShuttingDown = false;
  private messageHandler: MessageHandler;
  private slashHandler: SlashHandler;
  private threadHandler: ThreadHandler;
  private aiService?: AIService;

  constructor(
    aiService?: AIService,
    messageSplitter?: MessageSplitter,
    attachmentManager?: AttachmentManager,
    contextService?: ContextService
  ) {
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

    this.aiService = aiService;

    // Validate that dependencies are properly injected via DI
    if (!messageSplitter) {
      throw new Error('MessageSplitter must be injected via DI container');
    }
    if (!attachmentManager) {
      throw new Error('AttachmentManager must be injected via DI container');
    }
    if (!contextService) {
      throw new Error('ContextService must be injected via DI container');
    }

    // Initialize handlers with injected dependencies
    this.messageHandler = new MessageHandler(
      this.client, 
      messageSplitter,
      attachmentManager,
      contextService,
      aiService
    );
    this.slashHandler = new SlashHandler(
      this.client, 
      messageSplitter,
      attachmentManager,
      contextService,
      aiService
    );
    this.threadHandler = new ThreadHandler(this.client, aiService);

    this.setupEventHandlers();
    this.setupProcessHandlers();
    
    logger.info('Discord client initialized');
  }

  /**
   * Set AI service for dependency injection
   */
  setAIService(aiService: AIService): void {
    this.aiService = aiService;
    this.messageHandler.setAIService(aiService);
    this.slashHandler.setAIService(aiService);
    this.threadHandler.setAIService(aiService);
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

      // Health check for AI service
      try {
        if (this.aiService) {
          const isHealthy = await this.aiService.healthCheck();
          if (!isHealthy) {
            logger.warn('⚠️ AI service health check failed - API may be unavailable');
          } else {
            logger.info('✅ AI service health check passed');
          }
        } else {
          logger.warn('⚠️ No AI service configured');
        }
      } catch (error) {
        logger.error('❌ AI service health check error:', error);
      }
    });

    // Handle slash commands (for user app support)
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.slashHandler.handleSlashCommand(interaction);
    });

    // Handle messages (for mention detection in servers)
    this.client.on(Events.MessageCreate, async (message) => {
      if (message.author.bot) return;
      await this.messageHandler.handleMessage(message);
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
   * Set up process signal handlers for graceful shutdown
   */
  private setupProcessHandlers(): void {
    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info(`Received ${signal}. Shutting down gracefully...`);
      
      try {
        this.client.destroy();
        logger.info('Discord client destroyed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
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

  /**
   * Get connection status
   */
  get isReady(): boolean {
    return this.client.isReady();
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('Shutting down Discord client...');
    this.client.destroy();
  }
} 