import { logger } from '../logging';
import { AppError } from './error-types';

/**
 * Centralized Error Handler
 * Provides structured error handling, logging, and recovery strategies
 */

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium', 
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error handling result
 */
export interface ErrorHandlingResult {
  severity: ErrorSeverity;
  shouldRetry: boolean;
  retryAfter?: number;
  userMessage?: string;
}

/**
 * Global Error Handler Class
 */
export class ErrorHandler {
  /**
   * Handle any error with appropriate logging and response
   */
  static handle(error: Error | AppError, context?: Record<string, unknown>): ErrorHandlingResult {
    // Default error handling result
    let result: ErrorHandlingResult = {
      severity: ErrorSeverity.MEDIUM,
      shouldRetry: false,
      userMessage: 'An unexpected error occurred. Please try again later.'
    };

    // Enhanced context with error details
    const errorContext = {
      ...context,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };

    // Handle structured app errors
    if (error instanceof AppError) {
      result = this.handleAppError(error);
      
      // Log with structured context
      logger.error(`${error.constructor.name}: ${error.message}`, {
        ...errorContext,
        ...error.context,
        isOperational: error.isOperational,
        severity: result.severity
      });
    } else {
      // Handle unknown errors
      result = this.handleUnknownError(error);
      
      // Log as critical since we don't know what it is
      logger.error(`Unknown error: ${error.message}`, {
        ...errorContext,
        severity: result.severity,
        isOperational: false
      });
    }

    return result;
  }

  /**
   * Handle structured application errors
   */
  private static handleAppError(error: AppError): ErrorHandlingResult {
    switch (error.constructor.name) {
      case 'ConfigurationError':
        return {
          severity: ErrorSeverity.CRITICAL,
          shouldRetry: false,
          userMessage: 'Configuration error. Please contact an administrator.'
        };

      case 'DiscordError':
        return {
          severity: ErrorSeverity.MEDIUM,
          shouldRetry: true,
          retryAfter: 5000, // 5 seconds
          userMessage: 'Discord service temporarily unavailable. Retrying...'
        };

      case 'ClaudeError':
        return {
          severity: ErrorSeverity.HIGH,
          shouldRetry: true,
          retryAfter: 10000, // 10 seconds
          userMessage: 'AI service temporarily unavailable. Please try again in a moment.'
        };

      case 'RateLimitError':
        return {
          severity: ErrorSeverity.LOW,
          shouldRetry: true,
          retryAfter: 60000, // 1 minute
          userMessage: 'Rate limit exceeded. Please wait a moment before trying again.'
        };

      case 'DatabaseError':
        return {
          severity: ErrorSeverity.HIGH,
          shouldRetry: true,
          retryAfter: 15000, // 15 seconds
          userMessage: 'Database temporarily unavailable. Retrying...'
        };

      case 'FileProcessingError':
        return {
          severity: ErrorSeverity.MEDIUM,
          shouldRetry: false,
          userMessage: 'Unable to process the file. Please check the file format and try again.'
        };

      case 'TokenError':
        return {
          severity: ErrorSeverity.MEDIUM,
          shouldRetry: false,
          userMessage: 'Message too long. Please try with a shorter message.'
        };

      case 'ThreadError':
        return {
          severity: ErrorSeverity.MEDIUM,
          shouldRetry: true,
          retryAfter: 5000, // 5 seconds
          userMessage: 'Thread operation failed. Retrying...'
        };

      case 'ValidationError':
        return {
          severity: ErrorSeverity.LOW,
          shouldRetry: false,
          userMessage: 'Invalid input. Please check your request and try again.'
        };

      case 'ExternalServiceError':
        return {
          severity: ErrorSeverity.MEDIUM,
          shouldRetry: true,
          retryAfter: 10000, // 10 seconds
          userMessage: 'External service temporarily unavailable. Retrying...'
        };

      default:
        return {
          severity: ErrorSeverity.MEDIUM,
          shouldRetry: false,
          userMessage: 'An unexpected error occurred. Please try again later.'
        };
    }
  }

  /**
   * Handle unknown/unstructured errors
   */
  private static handleUnknownError(error: Error): ErrorHandlingResult {
    // Check for common error patterns
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
      return {
        severity: ErrorSeverity.MEDIUM,
        shouldRetry: true,
        retryAfter: 5000,
        userMessage: 'Network error. Retrying...'
      };
    }

    if (message.includes('permission') || message.includes('unauthorized') || message.includes('forbidden')) {
      return {
        severity: ErrorSeverity.HIGH,
        shouldRetry: false,
        userMessage: 'Permission denied. Please contact an administrator.'
      };
    }

    if (message.includes('not found') || message.includes('404')) {
      return {
        severity: ErrorSeverity.LOW,
        shouldRetry: false,
        userMessage: 'Resource not found. Please check your request.'
      };
    }

    // Default for unknown errors
    return {
      severity: ErrorSeverity.HIGH,
      shouldRetry: false,
      userMessage: 'An unexpected error occurred. Please try again later.'
    };
  }

  /**
   * Create a Discord-friendly error message
   */
  static createUserMessage(error: Error | AppError, context?: Record<string, unknown>): string {
    const result = this.handle(error, context);
    return result.userMessage || 'An error occurred. Please try again.';
  }

  /**
   * Determine if an error should trigger a retry
   */
  static shouldRetry(error: Error | AppError): boolean {
    const result = this.handle(error);
    return result.shouldRetry;
  }

  /**
   * Get retry delay for an error
   */
  static getRetryDelay(error: Error | AppError): number {
    const result = this.handle(error);
    return result.retryAfter || 0;
  }
}

/**
 * Convenience function for quick error handling
 */
export function handleError(error: Error | AppError, context?: Record<string, unknown>): ErrorHandlingResult {
  return ErrorHandler.handle(error, context);
}

/**
 * Process.on error handlers for uncaught exceptions
 */
export function setupGlobalErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', {
      error: error.message,
      stack: error.stack,
      type: 'UNCAUGHT_EXCEPTION'
    });
    
    // Give time for logs to flush, then exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error('Unhandled Rejection:', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString(),
      type: 'UNHANDLED_REJECTION'
    });
  });
} 