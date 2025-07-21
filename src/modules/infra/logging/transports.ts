import * as fs from 'fs/promises';
import * as path from 'path';
import { LogEntry, LogFormatter } from './formatters';

/**
 * Base transport interface
 */
export interface LogTransport {
  write(entry: LogEntry): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Console transport for standard output
 */
export class ConsoleTransport implements LogTransport {
  constructor(
    private formatter: LogFormatter,
    private options: {
      useStderr?: boolean; // Use stderr for error/warn levels
      bufferSize?: number; // Buffer size before flushing
    } = {}
  ) {}

  async write(entry: LogEntry): Promise<void> {
    const formatted = this.formatter.format(entry);
    
    if (this.options.useStderr && (entry.level === 'error' || entry.level === 'warn')) {
      process.stderr.write(formatted + '\n');
    } else {
      process.stdout.write(formatted + '\n');
    }
  }
}

/**
 * File transport for persistent logging
 */
export class FileTransport implements LogTransport {
  private writeBuffer: string[] = [];
  private isWriting = false;
  private writePromise?: Promise<void>;

  constructor(
    private formatter: LogFormatter,
    private options: {
      filename: string;
      maxSize?: number; // Max file size in bytes
      maxFiles?: number; // Max number of rotated files
      bufferSize?: number; // Number of entries to buffer
      flushInterval?: number; // Flush interval in ms
    }
  ) {
    this.options = {
      maxSize: 10 * 1024 * 1024, // 10MB default
      maxFiles: 5,
      bufferSize: 100,
      flushInterval: 5000,
      ...this.options
    };

    // Set up periodic flush
    if (this.options.flushInterval) {
      setInterval(() => {
        this.flush().catch(console.error);
      }, this.options.flushInterval);
    }
  }

  async write(entry: LogEntry): Promise<void> {
    const formatted = this.formatter.format(entry);
    this.writeBuffer.push(formatted);

    // Flush if buffer is full
    if (this.writeBuffer.length >= (this.options.bufferSize || 100)) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.writeBuffer.length === 0 || this.isWriting) {
      return this.writePromise;
    }

    this.isWriting = true;
    const linesToWrite = [...this.writeBuffer];
    this.writeBuffer = [];

    this.writePromise = this.doWrite(linesToWrite);
    await this.writePromise;
    this.isWriting = false;
  }

  private async doWrite(lines: string[]): Promise<void> {
    const content = lines.join('\n') + '\n';
    
    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(this.options.filename), { recursive: true });
      
      // Check if rotation is needed
      await this.rotateIfNeeded();
      
      // Append to file
      await fs.appendFile(this.options.filename, content, 'utf8');
      
    } catch (error) {
      // Fallback to console on write error
      console.error('Failed to write to log file:', error);
      console.log('Buffered logs:', content);
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stats = await fs.stat(this.options.filename);
      
      if (stats.size >= (this.options.maxSize || Infinity)) {
        await this.rotateFiles();
      }
    } catch (error) {
      // File doesn't exist yet, no rotation needed
    }
  }

  protected async rotateFiles(): Promise<void> {
    const maxFiles = this.options.maxFiles || 5;
    const baseName = this.options.filename;
    
    // Remove oldest file if it exists
    const oldestFile = `${baseName}.${maxFiles}`;
    try {
      await fs.unlink(oldestFile);
    } catch {
      // File might not exist
    }
    
    // Rotate existing files
    for (let i = maxFiles - 1; i >= 1; i--) {
      const oldFile = i === 1 ? baseName : `${baseName}.${i}`;
      const newFile = `${baseName}.${i + 1}`;
      
      try {
        await fs.rename(oldFile, newFile);
      } catch {
        // File might not exist
      }
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/**
 * Buffer transport for in-memory log storage
 */
export class BufferTransport implements LogTransport {
  private entries: LogEntry[] = [];

  constructor(
    private options: {
      maxEntries?: number;
      circularBuffer?: boolean; // Overwrite old entries when full
    } = {}
  ) {
    this.options = {
      maxEntries: 1000,
      circularBuffer: true,
      ...this.options
    };
  }

  async write(entry: LogEntry): Promise<void> {
    this.entries.push(entry);

    // Handle buffer overflow
    if (this.entries.length > (this.options.maxEntries || 1000)) {
      if (this.options.circularBuffer) {
        this.entries.shift(); // Remove oldest entry
      } else {
        this.entries.pop(); // Don't add new entry
      }
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  getRecentEntries(count: number): LogEntry[] {
    return this.entries.slice(-count);
  }

  clear(): void {
    this.entries = [];
  }

  search(filter: (entry: LogEntry) => boolean): LogEntry[] {
    return this.entries.filter(filter);
  }
}

/**
 * HTTP transport for remote logging services
 */
export class HttpTransport implements LogTransport {
  private buffer: LogEntry[] = [];
  private isFlushingBatch = false;

  constructor(
    private formatter: LogFormatter,
    private options: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      batchSize?: number;
      flushInterval?: number;
      timeout?: number;
      retryAttempts?: number;
      retryDelay?: number;
    }
  ) {
    this.options = {
      method: 'POST',
      batchSize: 50,
      flushInterval: 10000,
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...this.options
    };

    // Set up periodic batch flush
    if (this.options.flushInterval) {
      setInterval(() => {
        this.flushBatch().catch(console.error);
      }, this.options.flushInterval);
    }
  }

  async write(entry: LogEntry): Promise<void> {
    this.buffer.push(entry);

    // Flush batch if it's full
    if (this.buffer.length >= (this.options.batchSize || 50)) {
      await this.flushBatch();
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushingBatch) {
      return;
    }

    this.isFlushingBatch = true;
    const entriesToSend = [...this.buffer];
    this.buffer = [];

    try {
      await this.sendBatch(entriesToSend);
    } catch (error) {
      // Re-add entries to buffer on failure (at the front)
      this.buffer.unshift(...entriesToSend);
      console.error('Failed to send log batch:', error);
    } finally {
      this.isFlushingBatch = false;
    }
  }

  private async sendBatch(entries: LogEntry[]): Promise<void> {
    const payload = entries.map(entry => this.formatter.format(entry));
    
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < (this.options.retryAttempts || 3); attempt++) {
      try {
        const response = await fetch(this.options.url, {
          method: this.options.method,
          headers: {
            'Content-Type': 'application/json',
            ...this.options.headers
          },
          body: JSON.stringify({ logs: payload }),
          signal: AbortSignal.timeout(this.options.timeout || 30000)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return; // Success
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < (this.options.retryAttempts || 3) - 1) {
          await new Promise(resolve => 
            setTimeout(resolve, (this.options.retryDelay || 1000) * Math.pow(2, attempt))
          );
        }
      }
    }

    throw lastError;
  }

  async flush(): Promise<void> {
    await this.flushBatch();
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/**
 * Rotating file transport with size and time-based rotation
 */
export class RotatingFileTransport extends FileTransport {
  private rotationInterval?: NodeJS.Timeout;

  constructor(
    formatter: LogFormatter,
    options: {
      filename: string;
      maxSize?: number;
      maxFiles?: number;
      rotationPeriod?: 'daily' | 'weekly' | 'monthly';
      bufferSize?: number;
      flushInterval?: number;
    }
  ) {
    super(formatter, options);

    // Set up time-based rotation
    if (options.rotationPeriod) {
      this.setupTimeRotation(options.rotationPeriod);
    }
  }

  private setupTimeRotation(period: 'daily' | 'weekly' | 'monthly'): void {
    const getNextRotationTime = (): number => {
      const now = new Date();
      const next = new Date(now);

      switch (period) {
        case 'daily':
          next.setDate(next.getDate() + 1);
          next.setHours(0, 0, 0, 0);
          break;
        case 'weekly':
          next.setDate(next.getDate() + (7 - next.getDay()));
          next.setHours(0, 0, 0, 0);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          next.setDate(1);
          next.setHours(0, 0, 0, 0);
          break;
      }

      return next.getTime() - now.getTime();
    };

    const scheduleRotation = () => {
      const delay = getNextRotationTime();
      this.rotationInterval = setTimeout(async () => {
        await this.rotateFiles();
        scheduleRotation(); // Schedule next rotation
      }, delay);
    };

    scheduleRotation();
  }

  async close(): Promise<void> {
    if (this.rotationInterval) {
      clearTimeout(this.rotationInterval);
    }
    await super.close();
  }
}

/**
 * Composite transport that writes to multiple destinations
 */
export class CompositeTransport implements LogTransport {
  constructor(private transports: LogTransport[]) {}

  async write(entry: LogEntry): Promise<void> {
    // Write to all transports in parallel
    await Promise.allSettled(
      this.transports.map(transport => transport.write(entry))
    );
  }

  async flush(): Promise<void> {
    await Promise.allSettled(
      this.transports
        .filter(transport => transport.flush)
        .map(transport => transport.flush!())
    );
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      this.transports
        .filter(transport => transport.close)
        .map(transport => transport.close!())
    );
  }
}

/**
 * Transport factory for creating transports based on configuration
 */
export class TransportFactory {
  static create(type: string, formatter: LogFormatter, options: any = {}): LogTransport {
    switch (type.toLowerCase()) {
      case 'console':
        return new ConsoleTransport(formatter, options);
      case 'file':
        return new FileTransport(formatter, options);
      case 'rotating-file':
        return new RotatingFileTransport(formatter, options);
      case 'buffer':
        return new BufferTransport(options);
      case 'http':
        return new HttpTransport(formatter, options);
      case 'composite':
        return new CompositeTransport(options.transports || []);
      default:
        throw new Error(`Unknown transport type: ${type}`);
    }
  }

  static createDefault(environment: string = 'development'): LogTransport[] {
    switch (environment) {
      case 'production':
        // Production: Console + rotating file + optional HTTP
        return [
          new ConsoleTransport(
            new (require('./formatters').StructuredFormatter)({
              serviceName: 'discord-claude',
              environment: 'production'
            })
          ),
          new RotatingFileTransport(
            new (require('./formatters').JsonFormatter)(),
            {
              filename: 'logs/app.log',
              maxSize: 50 * 1024 * 1024, // 50MB
              maxFiles: 10,
              rotationPeriod: 'daily'
            }
          )
        ];
      
      case 'development':
      default:
        // Development: Console + file
        return [
          new ConsoleTransport(
            new (require('./formatters').DevelopmentFormatter)()
          ),
          new FileTransport(
            new (require('./formatters').JsonFormatter)({ pretty: true }),
            {
              filename: 'logs/dev.log',
              maxSize: 10 * 1024 * 1024, // 10MB
              maxFiles: 3
            }
          )
        ];
    }
  }
} 