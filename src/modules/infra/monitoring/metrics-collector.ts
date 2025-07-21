import { logger } from '../logging';

/**
 * Metric data point
 */
export interface MetricDataPoint {
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

/**
 * Aggregated metric statistics
 */
export interface MetricStats {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * System performance metrics
 */
export interface SystemMetrics {
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpu: {
    usage: number;
  };
  eventLoop: {
    delay: number;
  };
}

/**
 * Application-specific metrics
 */
export interface ApplicationMetrics {
  discord: {
    messagesProcessed: number;
    commandsExecuted: number;
    errors: number;
    guilds: number;
  };
  claude: {
    requestsTotal: number;
    requestsSuccessful: number;
    requestsFailed: number;
    tokensUsed: number;
    avgResponseTime: number;
    costEstimate: number;
  };
  database: {
    queriesTotal: number;
    queriesSuccessful: number;
    queriesFailed: number;
    avgQueryTime: number;
    connectionPoolSize: number;
  };
}

/**
 * Metrics Collector
 * Collects, aggregates, and provides system and application metrics
 */
export class MetricsCollector {
  private metrics: Map<string, MetricDataPoint[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private maxDataPoints = 1000; // Keep last 1000 data points per metric
  private startTime = Date.now();

  /**
   * Record a counter metric (incrementing value)
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.createMetricKey(name, labels);
    const currentValue = this.counters.get(key) || 0;
    this.counters.set(key, currentValue + value);
    
    this.recordDataPoint(key, currentValue + value, labels);
    
    logger.debug(`Counter incremented: ${name} = ${currentValue + value}`);
  }

  /**
   * Set a gauge metric (current value)
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.createMetricKey(name, labels);
    this.gauges.set(key, value);
    
    this.recordDataPoint(key, value, labels);
    
    logger.debug(`Gauge set: ${name} = ${value}`);
  }

  /**
   * Record a histogram metric (for measuring durations, sizes, etc.)
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.createMetricKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    
    // Keep only last N values for performance
    if (values.length > this.maxDataPoints) {
      values.splice(0, values.length - this.maxDataPoints);
    }
    
    this.histograms.set(key, values);
    this.recordDataPoint(key, value, labels);
    
    logger.debug(`Histogram recorded: ${name} = ${value}`);
  }

  /**
   * Time an operation and record as histogram
   */
  startTimer(name: string, labels?: Record<string, string>): () => void {
    const startTime = Date.now();
    
    return () => {
      const duration = Date.now() - startTime;
      this.recordHistogram(name, duration, labels);
    };
  }

  /**
   * Get counter value
   */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.createMetricKey(name, labels);
    return this.counters.get(key) || 0;
  }

  /**
   * Get gauge value
   */
  getGauge(name: string, labels?: Record<string, string>): number {
    const key = this.createMetricKey(name, labels);
    return this.gauges.get(key) || 0;
  }

  /**
   * Get histogram statistics
   */
  getHistogramStats(name: string, labels?: Record<string, string>): MetricStats | null {
    const key = this.createMetricKey(name, labels);
    const values = this.histograms.get(key);
    
    if (!values || values.length === 0) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      sum,
      avg: sum / count,
      min: sorted[0],
      max: sorted[count - 1],
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99)
    };
  }

  /**
   * Get all metrics for a specific name pattern
   */
  getMetrics(namePattern?: string): Map<string, MetricDataPoint[]> {
    if (!namePattern) {
      return new Map(this.metrics);
    }

    const filtered = new Map<string, MetricDataPoint[]>();
    for (const [key, value] of this.metrics.entries()) {
      if (key.includes(namePattern)) {
        filtered.set(key, value);
      }
    }
    return filtered;
  }

  /**
   * Get system performance metrics
   */
  getSystemMetrics(): SystemMetrics {
    const memory = process.memoryUsage();
    const uptime = Date.now() - this.startTime;

    return {
      uptime,
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024), // MB
        external: Math.round(memory.external / 1024 / 1024) // MB
      },
      cpu: {
        usage: process.cpuUsage().system / 1000000 // Convert to milliseconds
      },
      eventLoop: {
        delay: this.measureEventLoopDelay()
      }
    };
  }

  /**
   * Get application-specific metrics
   */
  getApplicationMetrics(): ApplicationMetrics {
    return {
      discord: {
        messagesProcessed: this.getCounter('discord_messages_processed'),
        commandsExecuted: this.getCounter('discord_commands_executed'),
        errors: this.getCounter('discord_errors'),
        guilds: this.getGauge('discord_guilds')
      },
      claude: {
        requestsTotal: this.getCounter('claude_requests_total'),
        requestsSuccessful: this.getCounter('claude_requests_successful'),
        requestsFailed: this.getCounter('claude_requests_failed'),
        tokensUsed: this.getCounter('claude_tokens_used'),
        avgResponseTime: this.getHistogramStats('claude_response_time')?.avg || 0,
        costEstimate: this.getCounter('claude_cost_estimate') / 100 // Store as cents, return as dollars
      },
      database: {
        queriesTotal: this.getCounter('database_queries_total'),
        queriesSuccessful: this.getCounter('database_queries_successful'),
        queriesFailed: this.getCounter('database_queries_failed'),
        avgQueryTime: this.getHistogramStats('database_query_time')?.avg || 0,
        connectionPoolSize: this.getGauge('database_connection_pool_size')
      }
    };
  }

  /**
   * Export metrics in Prometheus format (for future monitoring integration)
   */
  exportPrometheusMetrics(): string {
    const lines: string[] = [];
    
    // Export counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`# TYPE ${key} counter`);
      lines.push(`${key} ${value}`);
    }

    // Export gauges
    for (const [key, value] of this.gauges.entries()) {
      lines.push(`# TYPE ${key} gauge`);
      lines.push(`${key} ${value}`);
    }

    // Export histogram summaries
    for (const [key, values] of this.histograms.entries()) {
      if (values.length > 0) {
        const stats = this.getHistogramStats(key.split('{')[0]);
        if (stats) {
          lines.push(`# TYPE ${key} histogram`);
          lines.push(`${key}_count ${stats.count}`);
          lines.push(`${key}_sum ${stats.sum}`);
          lines.push(`${key}_bucket{le="0.5"} ${stats.p50}`);
          lines.push(`${key}_bucket{le="0.95"} ${stats.p95}`);
          lines.push(`${key}_bucket{le="0.99"} ${stats.p99}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
    
    logger.info('Metrics collector reset');
  }

  /**
   * Start periodic system metrics collection
   */
  startPeriodicCollection(intervalMs: number = 60000): void {
    setInterval(() => {
      const systemMetrics = this.getSystemMetrics();
      
      // Record system metrics as gauges
      this.setGauge('system_memory_rss', systemMetrics.memory.rss);
      this.setGauge('system_memory_heap_used', systemMetrics.memory.heapUsed);
      this.setGauge('system_memory_heap_total', systemMetrics.memory.heapTotal);
      this.setGauge('system_uptime', systemMetrics.uptime);
      this.setGauge('system_event_loop_delay', systemMetrics.eventLoop.delay);
      
    }, intervalMs);

    logger.info(`Started periodic metrics collection (${intervalMs}ms interval)`);
  }

  /**
   * Create a metric key with labels
   */
  private createMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }

    const labelPairs = Object.entries(labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    
    return `${name}{${labelPairs}}`;
  }

  /**
   * Record a data point for a metric
   */
  private recordDataPoint(key: string, value: number, labels?: Record<string, string>): void {
    const dataPoints = this.metrics.get(key) || [];
    
    dataPoints.push({
      value,
      timestamp: Date.now(),
      labels
    });

    // Keep only last N data points for performance
    if (dataPoints.length > this.maxDataPoints) {
      dataPoints.splice(0, dataPoints.length - this.maxDataPoints);
    }

    this.metrics.set(key, dataPoints);
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedArray: number[], p: number): number {
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * Measure event loop delay (simplified)
   */
  private measureEventLoopDelay(): number {
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const delay = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
      this.recordHistogram('event_loop_delay', delay);
    });
    return 0; // Return 0 as this is async measurement
  }
}

// Export singleton instance
export const metricsCollector = new MetricsCollector(); 