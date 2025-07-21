/**
 * Infrastructure Module
 * 
 * Centralized infrastructure concerns for the Discord Claude bot:
 * - Logging and monitoring
 * - Configuration management
 * - Rate limiting and throttling
 * - Error handling and recovery
 * - Validation and utilities
 * 
 * This module provides the foundational layer that all other modules depend on.
 * 
 * @example
 * ```typescript
 * import { logger, config, rateLimitService, ErrorHandler } from '@/modules/infra';
 * 
 * // Logging
 * logger.info('Application started');
 * 
 * // Configuration
 * console.log(config.botName);
 * 
 * // Rate limiting
 * const limitInfo = await rateLimitService.checkClaudeLimit(userId);
 * 
 * // Error handling
 * const result = ErrorHandler.handle(error, context);
 * ```
 */

// Export logging infrastructure
export {
  logger,
  discordLogger,
  startupLogger,
  LogTypes,
  type LogContext,
  type LogType
} from './logging';

// Export configuration management
export {
  config,
  environment,
  isDevelopment,
  isProduction,
  isTest,
  CLAUDE_SETTINGS,
  DELEGATE_CLAUDE_SETTINGS,
  TOKEN_MANAGEMENT,
  CONTEXT_MANAGEMENT,
  RATE_LIMITS,
  calculateTokenUsage,
  calculateAvailableTokens,
  validateAllConfiguration
} from './config';

// Export rate limiting
export {
  rateLimitService,
  RateLimitService,
  type RateLimitInfo
} from './rate-limiting';

// Export error handling
export {
  AppError,
  ConfigurationError,
  DiscordError,
  ClaudeError,
  RateLimitError,
  DatabaseError,
  FileProcessingError,
  TokenError,
  ThreadError,
  ValidationError,
  ExternalServiceError,
  ErrorHandler,
  ErrorSeverity,
  handleError,
  setupGlobalErrorHandlers,
  type ErrorHandlingResult
} from './errors';

// Export monitoring system
export {
  healthChecker,
  metricsCollector,
  alertManager,
  HealthChecker,
  MetricsCollector,
  AlertManager,
  AlertSeverity,
  type HealthCheckResult,
  type SystemHealth,
  type HealthCheckFunction,
  type MetricDataPoint,
  type MetricStats,
  type SystemMetrics,
  type ApplicationMetrics,
  type AlertRule,
  type AlertCondition,
  type AlertEvent,
  type AlertHandler
} from './monitoring';

// Export validation system
export {
  Validators,
  ValidationSchemas,
  ValidationMiddleware,
  type ValidationResult,
  type ValidationOptions,
  type StringValidationOptions,
  type NumberValidationOptions,
  type ValidationSchema,
  type DiscordMessageData,
  type ClaudeRequestData,
  type ThreadCreationData,
  type ThreadQueryData,
  type SummaryCreationData,
  type ConfigurationData
} from './validation';

// Export infrastructure types
export * from './types'; 