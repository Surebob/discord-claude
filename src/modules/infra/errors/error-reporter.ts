import { logger } from '../logging';
import { correlationManager } from '../logging/correlation';

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
 * Error report interface
 */
export interface ErrorReport {
  id: string;
  timestamp: Date;
  severity: ErrorSeverity;
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  context: {
    correlationId?: string;
    userId?: string;
    channelId?: string;
    guildId?: string;
    service: string;
    operation?: string;
    environment: string;
    version?: string;
  };
  metadata?: Record<string, any>;
  fingerprint: string; // For grouping similar errors
}

/**
 * Error reporter interface
 */
export interface ErrorReporter {
  report(report: ErrorReport): Promise<void>;
  reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void>;
}

/**
 * Console error reporter for development
 */
export class ConsoleErrorReporter implements ErrorReporter {
  async report(report: ErrorReport): Promise<void> {
    const severityIcon = {
      [ErrorSeverity.LOW]: '🟡',
      [ErrorSeverity.MEDIUM]: '🟠',
      [ErrorSeverity.HIGH]: '🔴',
      [ErrorSeverity.CRITICAL]: '🚨'
    };

    console.error('\n' + '='.repeat(80));
    console.error(`${severityIcon[report.severity]} ERROR REPORT [${report.severity.toUpperCase()}]`);
    console.error(`ID: ${report.id}`);
    console.error(`Time: ${report.timestamp.toISOString()}`);
    console.error(`Service: ${report.context.service}`);
    
    if (report.context.correlationId) {
      console.error(`Correlation: ${report.context.correlationId}`);
    }
    
    console.error(`\nError: ${report.error.name}: ${report.error.message}`);
    
    if (report.error.stack) {
      console.error(`\nStack Trace:`);
      console.error(report.error.stack);
    }

    if (report.context.userId || report.context.channelId) {
      console.error(`\nDiscord Context:`);
      if (report.context.userId) console.error(`  User: ${report.context.userId}`);
      if (report.context.channelId) console.error(`  Channel: ${report.context.channelId}`);
      if (report.context.guildId) console.error(`  Guild: ${report.context.guildId}`);
    }

    if (report.metadata && Object.keys(report.metadata).length > 0) {
      console.error(`\nMetadata:`);
      Object.entries(report.metadata).forEach(([key, value]) => {
        console.error(`  ${key}: ${JSON.stringify(value)}`);
      });
    }

    console.error('='.repeat(80) + '\n');
  }

  async reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void> {
    const report = this.createReport(error, context, metadata);
    await this.report(report);
  }

  private createReport(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): ErrorReport {
    const correlationContext = correlationManager.getContext();
    
    return {
      id: this.generateReportId(),
      timestamp: new Date(),
      severity: this.determineSeverity(error, context),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      },
      context: {
        service: 'discord-claude',
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version,
        correlationId: correlationContext?.correlationId,
        userId: correlationContext?.userId,
        channelId: correlationContext?.channelId,
        guildId: correlationContext?.guildId,
        ...context
      },
      metadata,
      fingerprint: this.generateFingerprint(error, context)
    };
  }

  private generateReportId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private determineSeverity(error: Error, context?: Partial<ErrorReport['context']>): ErrorSeverity {
    // Critical errors
    if (error.name === 'DatabaseConnectionError' || 
        error.name === 'AuthenticationError' ||
        error.message.includes('ECONNREFUSED')) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity errors
    if (error.name === 'DiscordAPIError' || 
        error.name === 'ClaudeAPIError' ||
        context?.operation === 'startup') {
      return ErrorSeverity.HIGH;
    }

    // Medium severity errors
    if (error.name === 'ValidationError' || 
        error.name === 'RateLimitError') {
      return ErrorSeverity.MEDIUM;
    }

    // Default to low severity
    return ErrorSeverity.LOW;
  }

  private generateFingerprint(error: Error, context?: Partial<ErrorReport['context']>): string {
    const key = `${error.name}:${context?.service || 'unknown'}:${context?.operation || 'unknown'}`;
    return Buffer.from(key).toString('base64').substring(0, 16);
  }
}

/**
 * HTTP error reporter for external services
 */
export class HttpErrorReporter implements ErrorReporter {
  constructor(
    private options: {
      endpoint: string;
      apiKey?: string;
      timeout?: number;
      retries?: number;
      batchSize?: number;
      flushInterval?: number;
    }
  ) {
    this.options = {
      timeout: 10000,
      retries: 3,
      batchSize: 10,
      flushInterval: 30000,
      ...this.options
    };

    // Set up periodic batch flushing
    if (this.options.flushInterval) {
      setInterval(() => {
        this.flushBatch().catch(console.error);
      }, this.options.flushInterval);
    }
  }

  private batch: ErrorReport[] = [];

  async report(report: ErrorReport): Promise<void> {
    this.batch.push(report);

    // Flush immediately for critical errors
    if (report.severity === ErrorSeverity.CRITICAL) {
      await this.flushBatch();
    }
    // Flush when batch is full
    else if (this.batch.length >= (this.options.batchSize || 10)) {
      await this.flushBatch();
    }
  }

  async reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void> {
    const report = this.createReport(error, context, metadata);
    await this.report(report);
  }

  private async flushBatch(): Promise<void> {
    if (this.batch.length === 0) return;

    const reportsToSend = [...this.batch];
    this.batch = [];

    try {
      await this.sendBatch(reportsToSend);
    } catch (error) {
      // Re-add to batch on failure and log the issue
      this.batch.unshift(...reportsToSend);
      logger.error('Failed to send error reports to external service', { error });
    }
  }

  private async sendBatch(reports: ErrorReport[]): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < (this.options.retries || 3); attempt++) {
      try {
        const response = await fetch(this.options.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.options.apiKey && { 'Authorization': `Bearer ${this.options.apiKey}` })
          },
          body: JSON.stringify({ reports }),
          signal: AbortSignal.timeout(this.options.timeout || 10000)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return; // Success

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < (this.options.retries || 3) - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  private createReport(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): ErrorReport {
    const correlationContext = correlationManager.getContext();
    
    return {
      id: this.generateReportId(),
      timestamp: new Date(),
      severity: this.determineSeverity(error, context),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      },
      context: {
        service: 'discord-claude',
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version,
        correlationId: correlationContext?.correlationId,
        userId: correlationContext?.userId,
        channelId: correlationContext?.channelId,
        guildId: correlationContext?.guildId,
        ...context
      },
      metadata,
      fingerprint: this.generateFingerprint(error, context)
    };
  }

  private generateReportId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private determineSeverity(error: Error, context?: Partial<ErrorReport['context']>): ErrorSeverity {
    // Critical errors
    if (error.name === 'DatabaseConnectionError' || 
        error.name === 'AuthenticationError' ||
        error.message.includes('ECONNREFUSED')) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity errors
    if (error.name === 'DiscordAPIError' || 
        error.name === 'ClaudeAPIError' ||
        context?.operation === 'startup') {
      return ErrorSeverity.HIGH;
    }

    // Medium severity errors
    if (error.name === 'ValidationError' || 
        error.name === 'RateLimitError') {
      return ErrorSeverity.MEDIUM;
    }

    // Default to low severity
    return ErrorSeverity.LOW;
  }

  private generateFingerprint(error: Error, context?: Partial<ErrorReport['context']>): string {
    const key = `${error.name}:${context?.service || 'unknown'}:${context?.operation || 'unknown'}`;
    return Buffer.from(key).toString('base64').substring(0, 16);
  }
}

/**
 * Discord webhook error reporter
 */
export class DiscordWebhookErrorReporter implements ErrorReporter {
  constructor(
    private webhookUrl: string,
    private options: {
      onlyHighSeverity?: boolean;
      includeStackTrace?: boolean;
      mentionRole?: string;
    } = {}
  ) {
    this.options = {
      onlyHighSeverity: true,
      includeStackTrace: false,
      ...this.options
    };
  }

  async report(report: ErrorReport): Promise<void> {
    // Skip low/medium severity if configured
    if (this.options.onlyHighSeverity && 
        ![ErrorSeverity.HIGH, ErrorSeverity.CRITICAL].includes(report.severity)) {
      return;
    }

    const embed = this.createDiscordEmbed(report);
    
    const payload = {
      content: this.options.mentionRole ? `<@&${this.options.mentionRole}>` : undefined,
      embeds: [embed]
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status}`);
      }
    } catch (error) {
      logger.error('Failed to send error report to Discord webhook', { error });
    }
  }

  async reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void> {
    const report = this.createReport(error, context, metadata);
    await this.report(report);
  }

  private createDiscordEmbed(report: ErrorReport) {
    const color = {
      [ErrorSeverity.LOW]: 0xffff00,      // Yellow
      [ErrorSeverity.MEDIUM]: 0xff9900,   // Orange  
      [ErrorSeverity.HIGH]: 0xff0000,     // Red
      [ErrorSeverity.CRITICAL]: 0x8b0000  // Dark Red
    };

    const fields: any[] = [
      {
        name: 'Error',
        value: `\`${report.error.name}: ${report.error.message}\``,
        inline: false
      },
      {
        name: 'Service',
        value: report.context.service,
        inline: true
      },
      {
        name: 'Environment',
        value: report.context.environment,
        inline: true
      }
    ];

    if (report.context.correlationId) {
      fields.push({
        name: 'Correlation ID',
        value: `\`${report.context.correlationId}\``,
        inline: true
      });
    }

    if (report.context.userId || report.context.channelId) {
      const discordContext: string[] = [];
      if (report.context.userId) discordContext.push(`User: ${report.context.userId}`);
      if (report.context.channelId) discordContext.push(`Channel: ${report.context.channelId}`);
      if (report.context.guildId) discordContext.push(`Guild: ${report.context.guildId}`);
      
      fields.push({
        name: 'Discord Context',
        value: discordContext.join('\n'),
        inline: false
      });
    }

    if (this.options.includeStackTrace && report.error.stack) {
      const stackTrace = report.error.stack.length > 1000 
        ? report.error.stack.substring(0, 1000) + '...' 
        : report.error.stack;
      
      fields.push({
        name: 'Stack Trace',
        value: `\`\`\`\n${stackTrace}\n\`\`\``,
        inline: false
      });
    }

    return {
      title: `🚨 ${report.severity.toUpperCase()} Error Report`,
      color: color[report.severity],
      fields,
      timestamp: report.timestamp.toISOString(),
      footer: {
        text: `ID: ${report.id}`
      }
    };
  }

  private createReport(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): ErrorReport {
    const correlationContext = correlationManager.getContext();
    
    return {
      id: this.generateReportId(),
      timestamp: new Date(),
      severity: this.determineSeverity(error, context),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      },
      context: {
        service: 'discord-claude',
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version,
        correlationId: correlationContext?.correlationId,
        userId: correlationContext?.userId,
        channelId: correlationContext?.channelId,
        guildId: correlationContext?.guildId,
        ...context
      },
      metadata,
      fingerprint: this.generateFingerprint(error, context)
    };
  }

  private generateReportId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private determineSeverity(error: Error, context?: Partial<ErrorReport['context']>): ErrorSeverity {
    // Critical errors
    if (error.name === 'DatabaseConnectionError' || 
        error.name === 'AuthenticationError' ||
        error.message.includes('ECONNREFUSED')) {
      return ErrorSeverity.CRITICAL;
    }

    // High severity errors
    if (error.name === 'DiscordAPIError' || 
        error.name === 'ClaudeAPIError' ||
        context?.operation === 'startup') {
      return ErrorSeverity.HIGH;
    }

    // Medium severity errors
    if (error.name === 'ValidationError' || 
        error.name === 'RateLimitError') {
      return ErrorSeverity.MEDIUM;
    }

    // Default to low severity
    return ErrorSeverity.LOW;
  }

  private generateFingerprint(error: Error, context?: Partial<ErrorReport['context']>): string {
    const key = `${error.name}:${context?.service || 'unknown'}:${context?.operation || 'unknown'}`;
    return Buffer.from(key).toString('base64').substring(0, 16);
  }
}

/**
 * Composite error reporter that sends to multiple destinations
 */
export class CompositeErrorReporter implements ErrorReporter {
  constructor(private reporters: ErrorReporter[]) {}

  async report(report: ErrorReport): Promise<void> {
    await Promise.allSettled(
      this.reporters.map(reporter => reporter.report(report))
    );
  }

  async reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void> {
    await Promise.allSettled(
      this.reporters.map(reporter => reporter.reportError(error, context, metadata))
    );
  }
}

/**
 * Error reporting manager
 */
export class ErrorReportingManager {
  private static instance?: ErrorReportingManager;
  private reporter?: ErrorReporter;

  private constructor() {}

  static getInstance(): ErrorReportingManager {
    if (!ErrorReportingManager.instance) {
      ErrorReportingManager.instance = new ErrorReportingManager();
    }
    return ErrorReportingManager.instance;
  }

  initialize(reporter: ErrorReporter): void {
    this.reporter = reporter;
  }

  async reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void> {
    if (!this.reporter) {
      console.error('Error reporter not initialized:', error);
      return;
    }

    await this.reporter.reportError(error, context, metadata);
  }

  getReporter(): ErrorReporter | undefined {
    return this.reporter;
  }
}

// Global error reporting manager
export const errorReportingManager = ErrorReportingManager.getInstance();

// Convenience function for reporting errors
export async function reportError(error: Error, context?: Partial<ErrorReport['context']>, metadata?: Record<string, any>): Promise<void> {
  await errorReportingManager.reportError(error, context, metadata);
} 