/**
 * Log Formatters
 * Different formatting strategies for log output
 */

export interface LogEntry {
  level: string;
  message: string;
  timestamp: Date;
  correlationId?: string;
  userId?: string;
  channelId?: string;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Base formatter interface
 */
export interface LogFormatter {
  format(entry: LogEntry): string;
}

/**
 * JSON formatter for structured logging
 */
export class JsonFormatter implements LogFormatter {
  constructor(
    private options: {
      pretty?: boolean;
      includeStack?: boolean;
      includeMetadata?: boolean;
    } = {}
  ) {}

  format(entry: LogEntry): string {
    const formatted = {
      timestamp: entry.timestamp.toISOString(),
      level: entry.level.toUpperCase(),
      message: entry.message,
      ...(entry.correlationId && { correlationId: entry.correlationId }),
      ...(entry.userId && { userId: entry.userId }),
      ...(entry.channelId && { channelId: entry.channelId }),
      ...(this.options.includeMetadata && entry.metadata && { metadata: entry.metadata }),
      ...(entry.error && {
        error: {
          name: entry.error.name,
          message: entry.error.message,
          ...(this.options.includeStack && entry.error.stack && { stack: entry.error.stack })
        }
      })
    };

    return this.options.pretty 
      ? JSON.stringify(formatted, null, 2)
      : JSON.stringify(formatted);
  }
}

/**
 * Console formatter for human-readable output
 */
export class ConsoleFormatter implements LogFormatter {
  private readonly colors = {
    error: '\x1b[31m',   // Red
    warn: '\x1b[33m',    // Yellow
    info: '\x1b[36m',    // Cyan
    debug: '\x1b[90m',   // Bright Black (Gray)
    reset: '\x1b[0m'     // Reset
  };

  constructor(
    private options: {
      colorize?: boolean;
      includeTimestamp?: boolean;
      includeLevel?: boolean;
      includeCorrelationId?: boolean;
      compact?: boolean;
    } = {}
  ) {
    // Default options
    this.options = {
      colorize: true,
      includeTimestamp: true,
      includeLevel: true,
      includeCorrelationId: true,
      compact: false,
      ...this.options
    };
  }

  format(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp
    if (this.options.includeTimestamp) {
      const timestamp = entry.timestamp.toLocaleTimeString();
      parts.push(`[${timestamp}]`);
    }

    // Level with color
    if (this.options.includeLevel) {
      const level = entry.level.toUpperCase().padEnd(5);
      if (this.options.colorize) {
        const color = this.colors[entry.level as keyof typeof this.colors] || this.colors.reset;
        parts.push(`${color}${level}${this.colors.reset}`);
      } else {
        parts.push(level);
      }
    }

    // Correlation ID
    if (this.options.includeCorrelationId && entry.correlationId) {
      parts.push(`[${entry.correlationId.substring(0, 8)}]`);
    }

    // Message
    parts.push(entry.message);

    // Context information
    const context: string[] = [];
    if (entry.userId) context.push(`user:${entry.userId}`);
    if (entry.channelId) context.push(`channel:${entry.channelId}`);
    
    if (context.length > 0 && !this.options.compact) {
      parts.push(`(${context.join(', ')})`);
    }

    // Error details
    if (entry.error) {
      parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
      if (entry.error.stack && !this.options.compact) {
        parts.push(`\n  Stack: ${entry.error.stack}`);
      }
    }

    // Metadata
    if (entry.metadata && Object.keys(entry.metadata).length > 0 && !this.options.compact) {
      const metadataStr = Object.entries(entry.metadata)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(', ');
      parts.push(`\n  Metadata: ${metadataStr}`);
    }

    return parts.join(' ');
  }
}

/**
 * Structured formatter for log aggregation systems
 */
export class StructuredFormatter implements LogFormatter {
  constructor(
    private options: {
      serviceName: string;
      version?: string;
      environment?: string;
      includeHostname?: boolean;
    }
  ) {}

  format(entry: LogEntry): string {
    const structured = {
      '@timestamp': entry.timestamp.toISOString(),
      '@level': entry.level,
      '@message': entry.message,
      '@service': this.options.serviceName,
      ...(this.options.version && { '@version': this.options.version }),
      ...(this.options.environment && { '@environment': this.options.environment }),
      ...(this.options.includeHostname && { '@hostname': require('os').hostname() }),
      ...(entry.correlationId && { correlationId: entry.correlationId }),
      ...(entry.userId && { userId: entry.userId }),
      ...(entry.channelId && { channelId: entry.channelId }),
      ...(entry.metadata && { fields: entry.metadata }),
      ...(entry.error && {
        error: {
          type: entry.error.name,
          message: entry.error.message,
          stack_trace: entry.error.stack
        }
      })
    };

    return JSON.stringify(structured);
  }
}

/**
 * Compact formatter for high-volume logging
 */
export class CompactFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const level = entry.level[0].toUpperCase(); // Just first letter
    const time = entry.timestamp.toISOString().substring(11, 23); // Just time portion
    const corrId = entry.correlationId ? entry.correlationId.substring(0, 8) : '';
    
    const parts = [
      time,
      level,
      corrId,
      entry.message.substring(0, 100) // Truncate long messages
    ].filter(Boolean);

    // Add error if present
    if (entry.error) {
      parts.push(`ERR:${entry.error.name}`);
    }

    return parts.join('|');
  }
}

/**
 * Development formatter with enhanced readability
 */
export class DevelopmentFormatter implements LogFormatter {
  private readonly levelIcons = {
    error: '🔴',
    warn: '🟡', 
    info: '🔵',
    debug: '⚪'
  };

  format(entry: LogEntry): string {
    const icon = this.levelIcons[entry.level as keyof typeof this.levelIcons] || '⚫';
    const time = entry.timestamp.toLocaleTimeString();
    const level = entry.level.toUpperCase();
    
    let output = `${icon} [${time}] ${level}: ${entry.message}`;

    // Add context in a readable way
    if (entry.correlationId || entry.userId || entry.channelId) {
      const context: string[] = [];
      if (entry.correlationId) context.push(`📋 ${entry.correlationId.substring(0, 8)}`);
      if (entry.userId) context.push(`👤 ${entry.userId}`);
      if (entry.channelId) context.push(`💬 ${entry.channelId}`);
      output += `\n    ${context.join(' | ')}`;
    }

    // Add error with better formatting
    if (entry.error) {
      output += `\n    ❌ ${entry.error.name}: ${entry.error.message}`;
      if (entry.error.stack) {
        // Format stack trace for readability
        const stackLines = entry.error.stack.split('\n').slice(1, 4); // First 3 stack frames
        stackLines.forEach(line => {
          output += `\n       ${line.trim()}`;
        });
      }
    }

    // Add metadata in a tree-like format
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      output += '\n    📊 Metadata:';
      Object.entries(entry.metadata).forEach(([key, value]) => {
        const valueStr = typeof value === 'object' 
          ? JSON.stringify(value, null, 2).split('\n').join('\n       ')
          : String(value);
        output += `\n       ${key}: ${valueStr}`;
      });
    }

    return output;
  }
}

/**
 * Formatter factory for creating formatters based on configuration
 */
export class FormatterFactory {
  static create(type: string, options: any = {}): LogFormatter {
    switch (type.toLowerCase()) {
      case 'json':
        return new JsonFormatter(options);
      case 'console':
        return new ConsoleFormatter(options);
      case 'structured':
        return new StructuredFormatter(options);
      case 'compact':
        return new CompactFormatter();
      case 'development':
        return new DevelopmentFormatter();
      default:
        throw new Error(`Unknown formatter type: ${type}`);
    }
  }

  static createDefault(environment: string = 'development'): LogFormatter {
    switch (environment) {
      case 'production':
        return new StructuredFormatter({
          serviceName: 'discord-claude',
          version: process.env.npm_package_version,
          environment: 'production',
          includeHostname: true
        });
      case 'staging':
        return new JsonFormatter({
          pretty: false,
          includeStack: true,
          includeMetadata: true
        });
      case 'development':
      default:
        return new DevelopmentFormatter();
    }
  }
} 