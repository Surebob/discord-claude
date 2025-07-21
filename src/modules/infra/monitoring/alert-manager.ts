import { logger } from '../logging';
import { healthChecker, HealthCheckResult } from './health-checker';
import { metricsCollector, MetricStats } from './metrics-collector';

/**
 * Alert severity levels
 */
export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning', 
  CRITICAL = 'critical'
}

/**
 * Alert configuration
 */
export interface AlertRule {
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: AlertCondition;
  enabled: boolean;
  cooldownMs: number; // Minimum time between alerts of the same type
}

/**
 * Alert condition types
 */
export type AlertCondition = 
  | { type: 'metric_threshold'; metric: string; operator: 'gt' | 'lt' | 'eq'; threshold: number }
  | { type: 'health_check'; service: string; status: 'unhealthy' | 'degraded' }
  | { type: 'memory_usage'; thresholdMB: number }
  | { type: 'error_rate'; metric: string; thresholdPercent: number; windowMs: number }
  | { type: 'response_time'; metric: string; thresholdMs: number; percentile: number };

/**
 * Alert event
 */
export interface AlertEvent {
  id: string;
  rule: AlertRule;
  triggered: boolean; // true = alert fired, false = alert resolved
  timestamp: number;
  value?: number;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Alert handler function type
 */
export type AlertHandler = (event: AlertEvent) => Promise<void> | void;

/**
 * Alert Manager
 * Monitors system metrics and health to trigger alerts when conditions are met
 */
export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private handlers: AlertHandler[] = [];
  private lastAlerts: Map<string, number> = new Map(); // Track last alert time for cooldown
  private activeAlerts: Map<string, AlertEvent> = new Map(); // Track active alerts
  private checkInterval?: NodeJS.Timeout;

  constructor() {
    this.registerDefaultRules();
    this.registerDefaultHandlers();
  }

  /**
   * Add an alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.name, rule);
    logger.debug(`Alert rule added: ${rule.name}`);
  }

  /**
   * Remove an alert rule
   */
  removeRule(name: string): void {
    this.rules.delete(name);
    this.lastAlerts.delete(name);
    this.activeAlerts.delete(name);
    logger.debug(`Alert rule removed: ${name}`);
  }

  /**
   * Enable/disable an alert rule
   */
  setRuleEnabled(name: string, enabled: boolean): void {
    const rule = this.rules.get(name);
    if (rule) {
      rule.enabled = enabled;
      logger.debug(`Alert rule ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Add an alert handler
   */
  addHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
    logger.debug('Alert handler registered');
  }

  /**
   * Start monitoring and checking alert conditions
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(() => {
      this.checkAlertConditions();
    }, intervalMs);

    logger.info(`Alert monitoring started (${intervalMs}ms interval)`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      logger.info('Alert monitoring stopped');
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): AlertEvent[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get all alert rules
   */
  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Manually trigger alert condition check
   */
  async checkAlertConditions(): Promise<void> {
    for (const [name, rule] of this.rules.entries()) {
      if (!rule.enabled) continue;

      try {
        const shouldAlert = await this.evaluateCondition(rule.condition);
        const isActive = this.activeAlerts.has(name);
        const lastAlertTime = this.lastAlerts.get(name) || 0;
        const now = Date.now();

        // Check cooldown
        if (shouldAlert && !isActive && (now - lastAlertTime) < rule.cooldownMs) {
          continue; // Still in cooldown period
        }

        if (shouldAlert && !isActive) {
          // Trigger new alert
          await this.triggerAlert(rule, true);
        } else if (!shouldAlert && isActive) {
          // Resolve existing alert
          await this.triggerAlert(rule, false);
        }
      } catch (error) {
        logger.error(`Error evaluating alert condition for ${name}:`, error);
      }
    }
  }

  /**
   * Register default alert rules
   */
  private registerDefaultRules(): void {
    // High memory usage
    this.addRule({
      name: 'high_memory_usage',
      description: 'Memory usage exceeds 512MB',
      severity: AlertSeverity.WARNING,
      condition: { type: 'memory_usage', thresholdMB: 512 },
      enabled: true,
      cooldownMs: 300000 // 5 minutes
    });

    // Critical memory usage
    this.addRule({
      name: 'critical_memory_usage',
      description: 'Memory usage exceeds 1GB',
      severity: AlertSeverity.CRITICAL,
      condition: { type: 'memory_usage', thresholdMB: 1024 },
      enabled: true,
      cooldownMs: 60000 // 1 minute
    });

    // High Claude error rate
    this.addRule({
      name: 'claude_high_error_rate',
      description: 'Claude API error rate exceeds 10%',
      severity: AlertSeverity.WARNING,
      condition: { 
        type: 'error_rate', 
        metric: 'claude_requests', 
        thresholdPercent: 10, 
        windowMs: 300000 // 5 minutes
      },
      enabled: true,
      cooldownMs: 600000 // 10 minutes
    });

    // Slow Claude responses
    this.addRule({
      name: 'claude_slow_responses',
      description: 'Claude API P95 response time exceeds 30 seconds',
      severity: AlertSeverity.WARNING,
      condition: { 
        type: 'response_time', 
        metric: 'claude_response_time', 
        thresholdMs: 30000, 
        percentile: 95 
      },
      enabled: true,
      cooldownMs: 300000 // 5 minutes
    });

    // Database health
    this.addRule({
      name: 'database_unhealthy',
      description: 'Database health check failed',
      severity: AlertSeverity.CRITICAL,
      condition: { type: 'health_check', service: 'database', status: 'unhealthy' },
      enabled: true,
      cooldownMs: 60000 // 1 minute
    });

    // Discord health
    this.addRule({
      name: 'discord_unhealthy',
      description: 'Discord connection health check failed',
      severity: AlertSeverity.CRITICAL,
      condition: { type: 'health_check', service: 'discord', status: 'unhealthy' },
      enabled: true,
      cooldownMs: 60000 // 1 minute
    });
  }

  /**
   * Register default alert handlers
   */
  private registerDefaultHandlers(): void {
    // Console logging handler
    this.addHandler((event: AlertEvent) => {
      const emoji = event.triggered ? '🚨' : '✅';
      const action = event.triggered ? 'TRIGGERED' : 'RESOLVED';
      const level = event.rule.severity === AlertSeverity.CRITICAL ? 'error' : 'warn';
      
      logger[level](`${emoji} ALERT ${action}: ${event.rule.name}`, {
        severity: event.rule.severity,
        message: event.message,
        value: event.value,
        context: event.context
      });
    });

    // Discord notification handler (if running in Discord context)
    this.addHandler(async (event: AlertEvent) => {
      // This would integrate with Discord to send notifications
      // For now, just log the intent
      if (event.rule.severity === AlertSeverity.CRITICAL) {
        logger.info(`Would send Discord notification for critical alert: ${event.rule.name}`);
      }
    });
  }

  /**
   * Evaluate an alert condition
   */
  private async evaluateCondition(condition: AlertCondition): Promise<boolean> {
    switch (condition.type) {
      case 'metric_threshold': {
        const value = metricsCollector.getCounter(condition.metric) || 
                     metricsCollector.getGauge(condition.metric) || 0;
        
        switch (condition.operator) {
          case 'gt': return value > condition.threshold;
          case 'lt': return value < condition.threshold;
          case 'eq': return value === condition.threshold;
        }
        break;
      }

      case 'health_check': {
        const health = await healthChecker.checkHealth();
        const serviceCheck = health.checks.find(c => c.service === condition.service);
        return serviceCheck?.status === condition.status;
      }

      case 'memory_usage': {
        const systemMetrics = metricsCollector.getSystemMetrics();
        return systemMetrics.memory.rss > condition.thresholdMB;
      }

      case 'error_rate': {
        const totalRequests = metricsCollector.getCounter(`${condition.metric}_total`);
        const failedRequests = metricsCollector.getCounter(`${condition.metric}_failed`);
        
        if (totalRequests === 0) return false;
        
        const errorRate = (failedRequests / totalRequests) * 100;
        return errorRate > condition.thresholdPercent;
      }

      case 'response_time': {
        const stats = metricsCollector.getHistogramStats(condition.metric);
        if (!stats) return false;
        
        const value = condition.percentile === 95 ? stats.p95 : 
                     condition.percentile === 99 ? stats.p99 : stats.avg;
        
        return value > condition.thresholdMs;
      }
    }

    return false;
  }

  /**
   * Trigger an alert (fire or resolve)
   */
  private async triggerAlert(rule: AlertRule, triggered: boolean): Promise<void> {
    const alertId = `${rule.name}_${Date.now()}`;
    const now = Date.now();

    // Get relevant value for context
    let value: number | undefined;
    let message: string;
    
    if (triggered) {
      message = `Alert triggered: ${rule.description}`;
      this.lastAlerts.set(rule.name, now);
    } else {
      message = `Alert resolved: ${rule.description}`;
    }

    const event: AlertEvent = {
      id: alertId,
      rule,
      triggered,
      timestamp: now,
      value,
      message,
      context: {
        ruleEnabled: rule.enabled,
        severity: rule.severity
      }
    };

    // Update active alerts
    if (triggered) {
      this.activeAlerts.set(rule.name, event);
    } else {
      this.activeAlerts.delete(rule.name);
    }

    // Notify all handlers
    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error('Error in alert handler:', error);
      }
    }
  }
}

// Export singleton instance
export const alertManager = new AlertManager(); 