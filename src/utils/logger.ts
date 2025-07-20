import winston from 'winston';

// Define logger configuration directly to avoid circular dependency
const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV === 'development';

// Custom format for better readability
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level}]: ${message}\n${stack}`;
    }
    return `${timestamp} [${level}]: ${message}`;
  })
);

// Production format (JSON)
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: logLevel,
  format: isDevelopment ? customFormat : productionFormat,
  defaultMeta: { service: 'discord-claude-bot' },
  transports: [
    // Console transport
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true
    }),
    
    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      handleExceptions: true,
      handleRejections: true,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      handleExceptions: true,
      handleRejections: true,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Discord-specific logging helpers
export const discordLogger = {
  mention: (userId: string, channelId: string, guildId?: string) => {
    logger.info(`👋 Bot mentioned by user`, {
      userId,
      channelId,
      guildId,
      type: 'MENTION'
    });
  },
  
  error: (error: Error, context?: Record<string, unknown>) => {
    logger.error(`❌ Discord error: ${error.message}`, {
      error: error.stack,
      context,
      type: 'DISCORD_ERROR'
    });
  }
};

// Startup logging
export const startupLogger = {
  init: (botName: string) => {
    logger.info(`🚀 Starting ${botName}...`, { type: 'STARTUP' });
  },
  
  ready: (botName: string, guilds: number) => {
    logger.info(`✅ ${botName} is online and ready!`, {
      guilds,
      type: 'READY'
    });
  },
  
  shutdown: (botName: string) => {
    logger.info(`🔄 ${botName} shutting down...`, { type: 'SHUTDOWN' });
  }
}; 