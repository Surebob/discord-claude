import { logger, startupLogger } from '../modules/infra/logging';
import { config } from '../modules/infra/config';
import { container } from './dependency-injection';

// Import new modules for DI registration
import { Database } from '../modules/data/database';
import { SummaryRepository } from '../modules/data/repositories/summary-repository';
import { ThreadRepository } from '../modules/data/repositories/thread-repository';
import { DiscordClient } from '../modules/discord/client';
import { FileProcessor } from '../modules/files/processor';
import { AttachmentManager } from '../modules/files/attachment-manager';
import { MessageSplitter } from '../modules/discord/formatters/message-splitter';
import { ContextService } from '../modules/data/context-service';
import { ThreadService } from '../modules/data/thread-service';
import { ClaudeAIService } from '../modules/ai/claude-service';
import { metricsEndpoint, metricsCollector } from '../modules/infra/monitoring';

/**
 * Application Orchestrator
 * Manages the entire application lifecycle using dependency injection
 */
export class Application {
  private isInitialized = false;
  private isStarted = false;

  /**
   * Initialize the application
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Application already initialized');
      return;
    }

    try {
      logger.info('Initializing application with modular architecture...');
      
      // Register all services in the DI container
      this.registerInfrastructureServices();
      this.registerDataServices();
      this.registerFileServices();
      this.registerDiscordServices();
      this.registerAIServices();

      // Services will be initialized lazily when resolved
      // No need to initialize all services upfront

      this.isInitialized = true;
      logger.info('Application initialized successfully with all modules');

    } catch (error) {
      logger.error('Failed to initialize application', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isStarted) {
      logger.warn('Application already started');
      return;
    }

    try {
      logger.info('Starting Discord Claude application...');
      
      // Resolve Discord client (this will trigger DI resolution chain)
      const discordClient = await container.resolve<DiscordClient>('discordClient');
      const aiService = await container.resolve<ClaudeAIService>('aiService');
      const threadService = await container.resolve<ThreadService>('threadService');
      
      // Set up cross-service dependencies that can't be handled by DI
      await discordClient.login();
      
      // Set thread context for AI service
      aiService.setThreadContext({
        discordClient: discordClient.client,
        currentChannel: null, // Will be set per request
        currentMessage: null  // Will be set per request
      });

      // Set Discord client for thread service  
      threadService.setDiscordClient(discordClient.client);
      
      // Start metrics collection if enabled
      if (process.env.METRICS_COLLECTION === 'true') {
        metricsCollector.startPeriodicCollection();
        metricsEndpoint.start();
        logger.info('📊 Metrics collection and endpoint enabled');
      }
      
      this.isStarted = true;
      logger.info('✅ Application started successfully');

    } catch (error) {
      logger.error('Failed to start application', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Stop the application gracefully
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      logger.warn('Application not started, nothing to stop');
      return;
    }

    try {
      startupLogger.shutdown(config.botName);

      // Stop metrics endpoint if running
      if (process.env.METRICS_COLLECTION === 'true') {
        metricsEndpoint.stop();
      }

      // Stop Discord client using DI container
      const discordClient = await container.resolve<DiscordClient>('discordClient');
      await discordClient.shutdown();

      this.isStarted = false;
      logger.info('Application stopped successfully');

    } catch (error) {
      logger.error('Error during application shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Shutdown the application
   */
  async shutdown(): Promise<void> {
    if (!this.isStarted) {
      logger.warn('Application not started, skipping shutdown');
      return;
    }

    try {
      // Stop metrics endpoint if running
      if (process.env.METRICS_COLLECTION === 'true') {
        metricsEndpoint.stop();
      }

      // Graceful shutdown using DI container
      const discordClient = await container.resolve<DiscordClient>('discordClient');
      await discordClient.shutdown();

      logger.info('Application shutdown complete');
      
    } catch (error) {
      logger.error('Error during application shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get application status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      started: this.isStarted,
      services: container.getServiceNames(),
      dependencyGraph: container.getDependencyGraph()
    };
  }

  /**
   * Register infrastructure services in the DI container
   */
  private registerInfrastructureServices(): void {
    // Register logger instance
    container.registerInstance('logger', logger);

    // Register configuration
    container.registerInstance('config', config);

    startupLogger.serviceRegistered('logger', []);
    startupLogger.serviceRegistered('config', []);
  }

  /**
   * Register data services in the DI container
   */
  private registerDataServices(): void {
    // Register database first (no dependencies)
    container.register('database', Database);

    // Register repositories with database dependency
    container.register('summaryRepository', SummaryRepository, { 
      dependencies: ['database'] 
    });

    container.register('threadRepository', ThreadRepository, { 
      dependencies: ['database'] 
    });

    // Register context service with repository dependency and secure API key
    container.register('contextService', ContextService, {
      dependencies: ['summaryRepository'],
      factory: async () => {
        const summaryRepository = await container.resolve<SummaryRepository>('summaryRepository');
        return new ContextService(summaryRepository, config.anthropicApiKey);
      }
    });

    // Register thread service with context service dependency
    container.register('threadService', ThreadService, {
      dependencies: ['contextService']
    });

    startupLogger.serviceRegistered('database', []);
    startupLogger.serviceRegistered('summaryRepository', ['database']);
    startupLogger.serviceRegistered('threadRepository', ['database']);
    startupLogger.serviceRegistered('contextService', ['summaryRepository']);
    startupLogger.serviceRegistered('threadService', ['contextService']);
  }

  /**
   * Register file processing services
   */
  private registerFileServices(): void {
    container.register('fileProcessor', FileProcessor);
    container.register('attachmentManager', AttachmentManager);

    startupLogger.serviceRegistered('fileProcessor', []);
    startupLogger.serviceRegistered('attachmentManager', []);
  }

  /**
   * Register Discord services in the DI container
   */
  private registerDiscordServices(): void {
    // Register message splitter (no dependencies)
    container.register('messageSplitter', MessageSplitter);

    // Register Discord client with all its dependencies
    container.register('discordClient', DiscordClient, {
      dependencies: ['aiService', 'messageSplitter', 'attachmentManager', 'contextService']
    });

    startupLogger.serviceRegistered('messageSplitter', []);
    startupLogger.serviceRegistered('discordClient', ['aiService', 'messageSplitter', 'attachmentManager', 'contextService']);
  }

  /**
   * Register AI services (enhanced with thread context)
   */
  private registerAIServices(): void {
    // Register the enhanced ClaudeAIService with secure API key injection
    container.register('aiService', ClaudeAIService, {
      factory: async () => {
        return new ClaudeAIService(config.anthropicApiKey);
      }
    });

    startupLogger.serviceRegistered('aiService', []);
  }
}

/**
 * Global application instance
 */
export const app = new Application(); 