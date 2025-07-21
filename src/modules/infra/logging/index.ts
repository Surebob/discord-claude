/**
 * Infrastructure Logging Module
 * 
 * Centralized logging system with specialized utilities for different concerns:
 * - Core logger with Winston integration
 * - Discord-specific logging helpers
 * - Application lifecycle logging
 * 
 * @example
 * ```typescript
 * import { logger, discordLogger, startupLogger } from '@/modules/infra/logging';
 * 
 * logger.info('General message');
 * discordLogger.mention(userId, channelId, guildId);
 * startupLogger.ready('Discord Claude Bot', 5);
 * ```
 */

// Export main logger
export { logger, default as createLogger } from './logger';

// Export specialized loggers
export { discordLogger } from './discord-logger';
export { startupLogger } from './startup-logger';

// Export types for logging context
export interface LogContext extends Record<string, unknown> {
  userId?: string;
  channelId?: string;
  guildId?: string;
  threadId?: string;
  messageId?: string;
  type?: string;
}

// Export logging utilities
export const LogTypes = {
  MENTION: 'MENTION',
  DISCORD_ERROR: 'DISCORD_ERROR',
  MESSAGE_PROCESSED: 'MESSAGE_PROCESSED',
  THREAD_EVENT: 'THREAD_EVENT',
  STARTUP: 'STARTUP',
  READY: 'READY',
  SHUTDOWN: 'SHUTDOWN',
  CONFIG_LOADED: 'CONFIG_LOADED',
  SERVICE_REGISTERED: 'SERVICE_REGISTERED'
} as const;

export type LogType = typeof LogTypes[keyof typeof LogTypes];

// Export enhanced logging components
export {
  JsonFormatter,
  ConsoleFormatter,
  StructuredFormatter,
  CompactFormatter,
  DevelopmentFormatter,
  FormatterFactory,
  type LogEntry,
  type LogFormatter
} from './formatters';

export {
  ConsoleTransport,
  FileTransport,
  BufferTransport,
  HttpTransport,
  RotatingFileTransport,
  CompositeTransport,
  TransportFactory,
  type LogTransport
} from './transports';

export {
  CorrelationManager,
  correlationManager,
  runWithMessageContext,
  runWithClaudeContext,
  runWithDatabaseContext,
  correlationMiddleware,
  withCorrelation,
  CorrelatedLogger,
  PerformanceTracker,
  type CorrelationContext
} from './correlation'; 