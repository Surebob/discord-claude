/**
 * Custom Error Types
 * Centralized error definitions for better error handling and categorization
 */

/**
 * Base application error with structured context
 */
export abstract class AppError extends Error {
  public readonly context: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    context: Record<string, unknown> = {},
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.isOperational = isOperational;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Configuration-related errors
 */
export class ConfigurationError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'CONFIGURATION_ERROR' });
  }
}

/**
 * Discord API-related errors
 */
export class DiscordError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'DISCORD_ERROR' });
  }
}

/**
 * Claude AI API-related errors
 */
export class ClaudeError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'CLAUDE_ERROR' });
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends AppError {
  public readonly resetTime: Date;
  public readonly remaining: number;

  constructor(
    message: string,
    resetTime: Date,
    remaining: number = 0,
    context: Record<string, unknown> = {}
  ) {
    super(message, { ...context, type: 'RATE_LIMIT_ERROR', resetTime, remaining });
    this.resetTime = resetTime;
    this.remaining = remaining;
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'DATABASE_ERROR' });
  }
}

/**
 * File processing errors
 */
export class FileProcessingError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'FILE_PROCESSING_ERROR' });
  }
}

/**
 * Token management errors
 */
export class TokenError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'TOKEN_ERROR' });
  }
}

/**
 * Thread management errors
 */
export class ThreadError extends AppError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, { ...context, type: 'THREAD_ERROR' });
  }
}

/**
 * Validation errors
 */
export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(
    message: string,
    field?: string,
    context: Record<string, unknown> = {}
  ) {
    super(message, { ...context, type: 'VALIDATION_ERROR', field });
    this.field = field;
  }
}

/**
 * External service errors
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly statusCode?: number;

  constructor(
    message: string,
    service: string,
    statusCode?: number,
    context: Record<string, unknown> = {}
  ) {
    super(message, { ...context, type: 'EXTERNAL_SERVICE_ERROR', service, statusCode });
    this.service = service;
    this.statusCode = statusCode;
  }
} 