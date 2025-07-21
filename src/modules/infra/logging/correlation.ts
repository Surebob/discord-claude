import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * Correlation context interface
 */
export interface CorrelationContext {
  correlationId: string;
  userId?: string;
  channelId?: string;
  guildId?: string;
  messageId?: string;
  requestStartTime: number;
  metadata?: Record<string, any>;
}

/**
 * Correlation ID Manager
 * Manages request correlation IDs using AsyncLocalStorage
 */
export class CorrelationManager {
  private static instance?: CorrelationManager;
  private storage = new AsyncLocalStorage<CorrelationContext>();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): CorrelationManager {
    if (!CorrelationManager.instance) {
      CorrelationManager.instance = new CorrelationManager();
    }
    return CorrelationManager.instance;
  }

  /**
   * Run a function with a correlation context
   */
  run<T>(context: Partial<CorrelationContext>, fn: () => T): T {
    const fullContext: CorrelationContext = {
      correlationId: context.correlationId || this.generateCorrelationId(),
      requestStartTime: Date.now(),
      ...context
    };

    return this.storage.run(fullContext, fn);
  }

  /**
   * Run a function with a new correlation ID
   */
  runWithNew<T>(
    contextData: Partial<Omit<CorrelationContext, 'correlationId' | 'requestStartTime'>>,
    fn: () => T
  ): T {
    return this.run(contextData, fn);
  }

  /**
   * Get the current correlation context
   */
  getContext(): CorrelationContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Get the current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.getContext()?.correlationId;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | undefined {
    return this.getContext()?.userId;
  }

  /**
   * Get the current channel ID
   */
  getChannelId(): string | undefined {
    return this.getContext()?.channelId;
  }

  /**
   * Update the current context with additional data
   */
  updateContext(updates: Partial<CorrelationContext>): void {
    const current = this.getContext();
    if (current) {
      Object.assign(current, updates);
    }
  }

  /**
   * Add metadata to the current context
   */
  addMetadata(key: string, value: any): void {
    const current = this.getContext();
    if (current) {
      if (!current.metadata) {
        current.metadata = {};
      }
      current.metadata[key] = value;
    }
  }

  /**
   * Get request duration in milliseconds
   */
  getRequestDuration(): number | undefined {
    const context = this.getContext();
    return context ? Date.now() - context.requestStartTime : undefined;
  }

  /**
   * Generate a new correlation ID (public accessor)
   */
  generateCorrelationId(): string {
    return randomUUID();
  }

  /**
   * Generate a new correlation ID (private implementation)
   */
  private generateCorrelationIdInternal(): string {
    return this.generateCorrelationId();
  }

  /**
   * Create a child correlation context
   */
  createChildContext(
    parentId?: string,
    additionalData: Partial<CorrelationContext> = {}
  ): CorrelationContext {
    const parent = this.getContext();
    const baseId = parentId || parent?.correlationId || this.generateCorrelationId();
    
    return {
      correlationId: `${baseId}-${Math.random().toString(36).substring(2, 8)}`,
      userId: parent?.userId,
      channelId: parent?.channelId,
      guildId: parent?.guildId,
      requestStartTime: Date.now(),
      ...additionalData
    };
  }

  /**
   * Extract correlation context from headers
   */
  extractFromHeaders(headers: Record<string, string>): Partial<CorrelationContext> {
    return {
      correlationId: headers['x-correlation-id'] || headers['correlation-id'],
      userId: headers['x-user-id'],
      channelId: headers['x-channel-id'],
      guildId: headers['x-guild-id']
    };
  }

  /**
   * Inject correlation context into headers
   */
  injectIntoHeaders(headers: Record<string, string> = {}): Record<string, string> {
    const context = this.getContext();
    if (!context) return headers;

    const enrichedHeaders = { ...headers };
    
    if (context.correlationId) {
      enrichedHeaders['x-correlation-id'] = context.correlationId;
    }
    if (context.userId) {
      enrichedHeaders['x-user-id'] = context.userId;
    }
    if (context.channelId) {
      enrichedHeaders['x-channel-id'] = context.channelId;
    }
    if (context.guildId) {
      enrichedHeaders['x-guild-id'] = context.guildId;
    }

    return enrichedHeaders;
  }
}

/**
 * Global correlation manager instance
 */
export const correlationManager = CorrelationManager.getInstance();

/**
 * Convenience functions for common operations
 */

/**
 * Run function with Discord message context
 */
export function runWithMessageContext<T>(
  messageData: {
    userId: string;
    channelId: string;
    guildId?: string;
    messageId: string;
  },
  fn: () => T
): T {
  return correlationManager.runWithNew({
    ...messageData,
    metadata: {
      messageType: 'discord',
      timestamp: new Date().toISOString()
    }
  }, fn);
}

/**
 * Run function with Claude API context
 */
export function runWithClaudeContext<T>(
  requestData: {
    model?: string;
    userId?: string;
    channelId?: string;
  },
  fn: () => T
): T {
  const parentContext = correlationManager.getContext();
  return correlationManager.run({
    correlationId: parentContext?.correlationId 
      ? `${parentContext.correlationId}-claude`
      : undefined,
    userId: requestData.userId || parentContext?.userId,
    channelId: requestData.channelId || parentContext?.channelId,
    metadata: {
      serviceType: 'claude',
      model: requestData.model,
      timestamp: new Date().toISOString()
    }
  }, fn);
}

/**
 * Run function with database operation context
 */
export function runWithDatabaseContext<T>(
  operation: string,
  fn: () => T
): T {
  const parentContext = correlationManager.getContext();
  return correlationManager.run({
    correlationId: parentContext?.correlationId 
      ? `${parentContext.correlationId}-db`
      : undefined,
    userId: parentContext?.userId,
    channelId: parentContext?.channelId,
    metadata: {
      serviceType: 'database',
      operation,
      timestamp: new Date().toISOString()
    }
  }, fn);
}

/**
 * Middleware for Express-like frameworks
 */
export function correlationMiddleware() {
  return (req: any, res: any, next: any) => {
    const correlationId = req.headers['x-correlation-id'] || 
                         req.headers['correlation-id'] ||
                         correlationManager.generateCorrelationId();

    correlationManager.run({
      correlationId,
      userId: req.headers['x-user-id'],
      channelId: req.headers['x-channel-id'],
      guildId: req.headers['x-guild-id'],
      metadata: {
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent']
      }
    }, () => {
      // Set response header
      res.setHeader('x-correlation-id', correlationId);
      next();
    });
  };
}

/**
 * Decorator for automatic correlation context
 */
export function withCorrelation(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = function(...args: any[]) {
    const existingContext = correlationManager.getContext();
    
    if (existingContext) {
      // Already in a correlation context, just call the method
      return originalMethod.apply(this, args);
    } else {
      // Create new correlation context
      return correlationManager.runWithNew({
        metadata: {
          className: target.constructor.name,
          methodName: propertyKey,
          timestamp: new Date().toISOString()
        }
      }, () => originalMethod.apply(this, args));
    }
  };

  return descriptor;
}

/**
 * Enhanced logger that automatically includes correlation context
 */
export class CorrelatedLogger {
  constructor(private baseLogger: any) {}

  private enrichWithCorrelation(level: string, message: string, metadata: any = {}) {
    const context = correlationManager.getContext();
    const enrichedMetadata = {
      ...metadata,
      ...(context && {
        correlationId: context.correlationId,
        userId: context.userId,
        channelId: context.channelId,
        guildId: context.guildId,
        requestDuration: correlationManager.getRequestDuration(),
        ...(context.metadata && { contextMetadata: context.metadata })
      })
    };

    return this.baseLogger[level](message, enrichedMetadata);
  }

  debug(message: string, metadata?: any) {
    return this.enrichWithCorrelation('debug', message, metadata);
  }

  info(message: string, metadata?: any) {
    return this.enrichWithCorrelation('info', message, metadata);
  }

  warn(message: string, metadata?: any) {
    return this.enrichWithCorrelation('warn', message, metadata);
  }

  error(message: string, metadata?: any) {
    return this.enrichWithCorrelation('error', message, metadata);
  }
}

/**
 * Performance tracking utilities
 */
export class PerformanceTracker {
  private static timers = new Map<string, number>();

  static start(operation: string): void {
    const context = correlationManager.getContext();
    const key = context?.correlationId 
      ? `${context.correlationId}-${operation}`
      : operation;
    
    this.timers.set(key, Date.now());
    
    correlationManager.addMetadata(`timing.${operation}.start`, Date.now());
  }

  static end(operation: string): number | undefined {
    const context = correlationManager.getContext();
    const key = context?.correlationId 
      ? `${context.correlationId}-${operation}`
      : operation;
    
    const startTime = this.timers.get(key);
    if (!startTime) return undefined;

    const duration = Date.now() - startTime;
    this.timers.delete(key);
    
    correlationManager.addMetadata(`timing.${operation}.duration`, duration);
    correlationManager.addMetadata(`timing.${operation}.end`, Date.now());
    
    return duration;
  }

  static time<T>(operation: string, fn: () => T): T {
    this.start(operation);
    try {
      const result = fn();
      return result;
    } finally {
      this.end(operation);
    }
  }

  static async timeAsync<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    this.start(operation);
    try {
      const result = await fn();
      return result;
    } finally {
      this.end(operation);
    }
  }
} 