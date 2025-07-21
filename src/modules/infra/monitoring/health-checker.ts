import { logger } from '../logging';
import { config } from '../config';

/**
 * Health Check Result
 */
export interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Overall System Health
 */
export interface SystemHealth {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheckResult[];
  uptime: number;
  timestamp: string;
}

/**
 * Health Check Function Type
 */
export type HealthCheckFunction = () => Promise<HealthCheckResult>;

/**
 * System Health Checker
 * Monitors the health of all system components
 */
export class HealthChecker {
  private checks: Map<string, HealthCheckFunction> = new Map();
  private startTime: number = Date.now();
  private lastHealthCheck?: SystemHealth;

  constructor() {
    this.registerDefaultChecks();
  }

  /**
   * Register a health check function
   */
  registerCheck(name: string, checkFunction: HealthCheckFunction): void {
    this.checks.set(name, checkFunction);
    logger.debug(`Health check registered: ${name}`);
  }

  /**
   * Remove a health check
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
    logger.debug(`Health check unregistered: ${name}`);
  }

  /**
   * Run all health checks
   */
  async checkHealth(): Promise<SystemHealth> {
    const startTime = Date.now();
    const results: HealthCheckResult[] = [];

    // Run all health checks in parallel
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, checkFn]) => {
      try {
        const result = await Promise.race([
          checkFn(),
          this.timeoutCheck(name, 5000) // 5 second timeout
        ]);
        return result;
      } catch (error) {
        return {
          service: name,
          status: 'unhealthy' as const,
          responseTime: Date.now() - startTime,
          message: error instanceof Error ? error.message : 'Unknown error',
          details: { error: String(error) }
        };
      }
    });

    results.push(...await Promise.all(checkPromises));

    // Determine overall system status
    const overallStatus = this.calculateOverallStatus(results);
    
    const systemHealth: SystemHealth = {
      status: overallStatus,
      checks: results,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString()
    };

    this.lastHealthCheck = systemHealth;

    // Log health status
    const unhealthyChecks = results.filter(r => r.status === 'unhealthy');
    if (unhealthyChecks.length > 0) {
      logger.warn('System health degraded', {
        status: overallStatus,
        unhealthy: unhealthyChecks.map(c => c.service),
        totalChecks: results.length
      });
    } else {
      logger.debug('System health check completed', {
        status: overallStatus,
        totalChecks: results.length,
        avgResponseTime: results.reduce((sum, r) => sum + r.responseTime, 0) / results.length
      });
    }

    return systemHealth;
  }

  /**
   * Get the last health check result
   */
  getLastHealthCheck(): SystemHealth | undefined {
    return this.lastHealthCheck;
  }

  /**
   * Check if system is healthy
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.checkHealth();
    return health.status === 'healthy';
  }

  /**
   * Get system uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Register default system health checks
   */
  private registerDefaultChecks(): void {
    // Memory usage check
    this.registerCheck('memory', async () => {
      const usage = process.memoryUsage();
      const totalMB = Math.round(usage.rss / 1024 / 1024);
      const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
      
      // Consider unhealthy if using more than 1GB
      const isUnhealthy = totalMB > 1024;
      const isDegraded = totalMB > 512;

      return {
        service: 'memory',
        status: isUnhealthy ? 'unhealthy' : isDegraded ? 'degraded' : 'healthy',
        responseTime: 1, // Memory check is instant
        message: `${totalMB}MB used`,
        details: {
          rss: totalMB,
          heapUsed: heapUsedMB,
          heapTotal: heapTotalMB,
          external: Math.round(usage.external / 1024 / 1024)
        }
      };
    });

    // Process uptime check
    this.registerCheck('process', async () => {
      const uptime = process.uptime();
      const uptimeHours = Math.round(uptime / 3600 * 100) / 100;

      return {
        service: 'process',
        status: 'healthy',
        responseTime: 1,
        message: `${uptimeHours}h uptime`,
        details: {
          uptime: uptime,
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform
        }
      };
    });

    // Configuration check
    this.registerCheck('config', async () => {
      try {
        // Verify essential config is present
        const hasToken = !!config.token;
        const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
        const hasClientId = !!config.clientId;

        const missingConfig = [];
        if (!hasToken) missingConfig.push('DISCORD_TOKEN');
        if (!hasApiKey) missingConfig.push('ANTHROPIC_API_KEY');
        if (!hasClientId) missingConfig.push('DISCORD_CLIENT_ID');

        const isHealthy = missingConfig.length === 0;

        return {
          service: 'config',
          status: isHealthy ? 'healthy' : 'unhealthy',
          responseTime: 1,
          message: isHealthy ? 'Configuration valid' : `Missing: ${missingConfig.join(', ')}`,
          details: {
            hasToken,
            hasApiKey,
            hasClientId,
            botName: config.botName,
            missingConfig
          }
        };
      } catch (error) {
        return {
          service: 'config',
          status: 'unhealthy',
          responseTime: 1,
          message: 'Configuration error',
          details: { error: String(error) }
        };
      }
    });
  }

  /**
   * Create a timeout check
   */
  private async timeoutCheck(serviceName: string, timeoutMs: number): Promise<HealthCheckResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Calculate overall system status from individual check results
   */
  private calculateOverallStatus(results: HealthCheckResult[]): 'healthy' | 'unhealthy' | 'degraded' {
    if (results.length === 0) return 'unhealthy';

    const unhealthyCount = results.filter(r => r.status === 'unhealthy').length;
    const degradedCount = results.filter(r => r.status === 'degraded').length;

    // If any critical check is unhealthy, system is unhealthy
    if (unhealthyCount > 0) return 'unhealthy';
    
    // If any check is degraded, system is degraded
    if (degradedCount > 0) return 'degraded';

    return 'healthy';
  }
}

// Export singleton instance
export const healthChecker = new HealthChecker(); 