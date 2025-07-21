import { logger } from './logger';

/**
 * Application startup and lifecycle logging utilities
 * Provides structured logging for application state changes
 */
export const startupLogger = {
  /**
   * Log application initialization
   */
  init: (botName: string) => {
    logger.info(`🚀 Starting ${botName}...`, { type: 'STARTUP' });
  },
  
  /**
   * Log successful startup and readiness
   */
  ready: (botName: string, guilds: number) => {
    logger.info(`✅ ${botName} is online and ready!`, {
      guilds,
      type: 'READY'
    });
  },
  
  /**
   * Log graceful shutdown
   */
  shutdown: (botName: string) => {
    logger.info(`🔄 ${botName} shutting down...`, { type: 'SHUTDOWN' });
  },

  /**
   * Log configuration loading
   */
  configLoaded: (configSources: string[]) => {
    logger.info(`⚙️ Configuration loaded`, {
      sources: configSources,
      type: 'CONFIG_LOADED'
    });
  },

  /**
   * Log service registration
   */
  serviceRegistered: (serviceName: string, dependencies: string[]) => {
    logger.debug(`🔧 Service registered: ${serviceName}`, {
      serviceName,
      dependencies,
      type: 'SERVICE_REGISTERED'
    });
  }
}; 