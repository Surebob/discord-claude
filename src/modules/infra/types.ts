/**
 * Infrastructure Types and Interfaces
 * Centralized type definitions for all infrastructure components
 */

/**
 * Common result types
 */
export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  metadata?: Record<string, any>;
}

export interface AsyncServiceResult<T> extends Promise<ServiceResult<T>> {}

/**
 * Health check types
 */
export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  component: string;
  timestamp: Date;
  responseTime?: number;
  details?: Record<string, any>;
  error?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheckResult[];
  timestamp: Date;
  uptime: number;
  version?: string;
}

/**
 * Configuration types
 */
export interface ConfigurationModule {
  name: string;
  version: string;
  isValid: boolean;
  lastValidated: Date;
  dependencies: string[];
  settings: Record<string, any>;
}

export interface ConfigurationStatus {
  isValid: boolean;
  modules: ConfigurationModule[];
  errors: string[];
  warnings: string[];
  environment: string;
}

/**
 * Monitoring and metrics types
 */
export interface MetricPoint {
  name: string;
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
  type: 'counter' | 'gauge' | 'histogram';
}

export interface MetricSnapshot {
  metrics: MetricPoint[];
  timestamp: Date;
  period: {
    start: Date;
    end: Date;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  condition: string; // e.g., "memory_usage > 80"
  severity: 'low' | 'medium' | 'high' | 'critical';
  cooldown: number; // milliseconds
  enabled: boolean;
  lastTriggered?: Date;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved?: Date;
  context?: Record<string, any>;
}

/**
 * Rate limiting types
 */
export interface RateLimitRule {
  id: string;
  name: string;
  limit: number;
  window: number; // milliseconds
  scope: 'global' | 'user' | 'channel' | 'guild';
  enabled: boolean;
}

export interface RateLimitStatus {
  limited: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

/**
 * Circuit breaker types
 */
export interface CircuitBreakerStatus {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  nextRetry?: Date;
}

export interface ServiceBreaker {
  name: string;
  status: CircuitBreakerStatus;
  config: {
    failureThreshold: number;
    successThreshold: number;
    timeout: number;
    recoveryTimeout: number;
  };
}

/**
 * Database types
 */
export interface DatabaseConnectionInfo {
  host: string;
  port: number;
  database: string;
  ssl: boolean;
  poolSize: number;
  connectionTimeout: number;
}

export interface DatabaseHealthInfo extends HealthCheckResult {
  details: {
    activeConnections: number;
    maxConnections: number;
    uptime: number;
    version: string;
    lastQuery?: Date;
  };
}

export interface MigrationInfo {
  id: string;
  name: string;
  appliedAt: Date;
  checksum: string;
  executionTime: number;
}

/**
 * Logging types
 */
export interface LogLevel {
  name: string;
  value: number;
  color?: string;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: Date;
  correlationId?: string;
  userId?: string;
  channelId?: string;
  guildId?: string;
  service?: string;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LoggerConfig {
  level: string;
  format: 'json' | 'console' | 'structured' | 'development';
  transports: LogTransportConfig[];
  correlation: {
    enabled: boolean;
    headerName?: string;
  };
}

export interface LogTransportConfig {
  type: 'console' | 'file' | 'http' | 'buffer';
  level?: string;
  options: Record<string, any>;
}

/**
 * Validation types
 */
export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'email' | 'url' | 'discord_id';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  custom?: (value: any) => boolean | string;
}

export interface ValidationSchema {
  name: string;
  rules: ValidationRule[];
  strict?: boolean; // Reject unknown fields
}

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value?: any;
  }>;
  sanitized?: Record<string, any>;
}

/**
 * Service registry types
 */
export interface ServiceDefinition {
  name: string;
  version: string;
  type: 'singleton' | 'transient' | 'scoped';
  dependencies: string[];
  factory?: () => any;
  instance?: any;
  initialized: boolean;
  healthCheck?: () => Promise<HealthCheckResult>;
}

export interface ServiceRegistry {
  services: Map<string, ServiceDefinition>;
  dependencyGraph: Record<string, string[]>;
  initialized: boolean;
}

/**
 * Event system types
 */
export interface InfrastructureEvent {
  type: string;
  source: string;
  timestamp: Date;
  data: Record<string, any>;
  correlationId?: string;
}

export interface EventHandler<T = any> {
  handle(event: InfrastructureEvent & { data: T }): Promise<void> | void;
}

export interface EventBus {
  emit<T>(type: string, data: T, source?: string): Promise<void>;
  on<T>(type: string, handler: EventHandler<T>): void;
  off<T>(type: string, handler: EventHandler<T>): void;
  removeAllListeners(type?: string): void;
}

/**
 * Performance monitoring types
 */
export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count' | 'percent';
  timestamp: Date;
  context?: Record<string, any>;
}

export interface PerformanceSnapshot {
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    total: number;
    heap: {
      used: number;
      total: number;
    };
  };
  uptime: number;
  timestamp: Date;
}

/**
 * External service integration types
 */
export interface ExternalServiceConfig {
  name: string;
  baseUrl: string;
  timeout: number;
  retries: number;
  auth?: {
    type: 'bearer' | 'api_key' | 'basic';
    credentials: Record<string, string>;
  };
  rateLimit?: {
    limit: number;
    window: number;
  };
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeout: number;
  };
}

export interface ExternalServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  lastCheck: Date;
  responseTime?: number;
  rateLimit?: RateLimitStatus;
  circuitBreaker?: CircuitBreakerStatus;
  error?: string;
}

/**
 * Infrastructure module types
 */
export interface InfrastructureModule {
  name: string;
  version: string;
  dependencies: string[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
  getMetrics?(): Promise<MetricPoint[]>;
}

export interface ModuleRegistry {
  modules: Map<string, InfrastructureModule>;
  initializationOrder: string[];
  shutdownOrder: string[];
}

/**
 * Common utility types
 */
export type AsyncFunction<T = any> = () => Promise<T>;
export type SyncFunction<T = any> = () => T;

export interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoff?: 'linear' | 'exponential';
  retryIf?: (error: Error) => boolean;
}

export interface ThrottleOptions {
  limit: number;
  window: number; // milliseconds
  strategy?: 'sliding' | 'fixed';
}

export interface CacheOptions {
  ttl: number; // milliseconds
  maxSize?: number;
  strategy?: 'lru' | 'fifo';
}

/**
 * Environment and context types
 */
export interface RuntimeEnvironment {
  name: 'development' | 'staging' | 'production';
  version: string;
  startTime: Date;
  nodeVersion: string;
  platform: string;
  architecture: string;
  memoryLimit?: number;
  cpuLimit?: number;
}

export interface RequestContext {
  id: string;
  startTime: Date;
  userId?: string;
  channelId?: string;
  guildId?: string;
  service: string;
  operation?: string;
  metadata?: Record<string, any>;
}

/**
 * Infrastructure configuration root type
 */
export interface InfrastructureConfig {
  environment: RuntimeEnvironment;
  logging: LoggerConfig;
  monitoring: {
    enabled: boolean;
    interval: number;
    retention: number;
    alerts: AlertRule[];
  };
  database: {
    url: string;
    pool: {
      min: number;
      max: number;
      timeout: number;
    };
    migrations: {
      auto: boolean;
      directory: string;
    };
  };
  rateLimiting: {
    enabled: boolean;
    rules: RateLimitRule[];
    storage: 'memory' | 'redis';
  };
  circuitBreaker: {
    enabled: boolean;
    services: ServiceBreaker[];
  };
  externalServices: ExternalServiceConfig[];
} 