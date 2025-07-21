/**
 * Infrastructure Monitoring Module
 * 
 * Comprehensive system monitoring with health checks, metrics collection, and alerting:
 * - Health checking for all system components
 * - Performance metrics collection and aggregation
 * - Intelligent alerting with configurable rules and handlers
 * - Prometheus-compatible metrics export
 * 
 * @example
 * ```typescript
 * import { healthChecker, metricsCollector, alertManager } from '@/modules/infra/monitoring';
 * 
 * // Check system health
 * const health = await healthChecker.checkHealth();
 * console.log(`System status: ${health.status}`);
 * 
 * // Record metrics
 * metricsCollector.incrementCounter('requests_total');
 * metricsCollector.recordHistogram('response_time', 150);
 * 
 * // Monitor with alerts
 * alertManager.startMonitoring();
 * ```
 */

// Export health checking
export {
  HealthChecker,
  healthChecker,
  type HealthCheckResult,
  type SystemHealth,
  type HealthCheckFunction
} from './health-checker';

// Export metrics collection
export {
  MetricsCollector,
  metricsCollector,
  type MetricDataPoint,
  type MetricStats,
  type SystemMetrics,
  type ApplicationMetrics
} from './metrics-collector';

// Export alert management
export {
  AlertManager,
  alertManager,
  AlertSeverity,
  type AlertRule,
  type AlertCondition,
  type AlertEvent,
  type AlertHandler
} from './alert-manager'; 