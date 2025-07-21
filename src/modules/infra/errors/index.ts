/**
 * Infrastructure Error Handling Module
 * 
 * Centralized error handling system with structured error types and recovery strategies:
 * - Custom error types for different application domains
 * - Structured error handling with context and severity
 * - Automatic retry logic and user-friendly messages
 * - Global error handlers for uncaught exceptions
 * 
 * @example
 * ```typescript
 * import { ClaudeError, ErrorHandler, handleError } from '@/modules/infra/errors';
 * 
 * try {
 *   // Some Claude API call
 * } catch (error) {
 *   const result = ErrorHandler.handle(error, { userId, channelId });
 *   if (result.shouldRetry) {
 *     // Retry logic
 *   }
 *   return result.userMessage;
 * }
 * ```
 */

// Export error types
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
  ExternalServiceError
} from './error-types';

// Export error handler
export {
  ErrorHandler,
  ErrorSeverity,
  handleError,
  setupGlobalErrorHandlers,
  type ErrorHandlingResult
} from './error-handler';

// Export error reporting
export {
  ConsoleErrorReporter,
  HttpErrorReporter,
  DiscordWebhookErrorReporter,
  CompositeErrorReporter,
  ErrorReportingManager,
  errorReportingManager,
  reportError,
  ErrorSeverity as ReportingSeverity,
  type ErrorReport,
  type ErrorReporter
} from './error-reporter'; 