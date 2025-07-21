import { createServer, IncomingMessage, ServerResponse } from 'http';
import { metricsCollector } from './metrics-collector';
import { healthChecker } from './health-checker';
import { logger } from '../logging';

/**
 * Metrics HTTP Endpoint
 * Provides Prometheus-compatible metrics export via HTTP
 */
export class MetricsEndpoint {
  private server?: ReturnType<typeof createServer>;
  private port: number;

  constructor(port: number = 9090) {
    this.port = port;
  }

  /**
   * Start the metrics HTTP server
   */
  start(): void {
    if (this.server) {
      logger.warn('Metrics endpoint already started');
      return;
    }

    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Handle different endpoints
      if (req.url === '/metrics') {
        await this.handleMetrics(req, res);
      } else if (req.url === '/health') {
        await this.handleHealth(req, res);
      } else {
        res.statusCode = 404;
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      logger.info(`📊 Metrics endpoint started on http://localhost:${this.port}/metrics`);
      logger.info(`🏥 Health endpoint available at http://localhost:${this.port}/health`);
    });

    // Handle server errors
    this.server.on('error', (error) => {
      logger.error('Metrics endpoint error:', error);
    });
  }

  /**
   * Stop the metrics server
   */
  stop(): void {
    if (this.server) {
      this.server.close(() => {
        logger.info('Metrics endpoint stopped');
      });
      this.server = undefined;
    }
  }

  /**
   * Handle /metrics endpoint
   */
  private async handleMetrics(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Get Prometheus-formatted metrics
      const metrics = metricsCollector.exportPrometheusMetrics();
      
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.end(metrics);
    } catch (error) {
      logger.error('Error serving metrics:', error);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }

  /**
   * Handle /health endpoint
   */
  private async handleHealth(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const health = await healthChecker.checkHealth();
      
      res.statusCode = health.status === 'healthy' ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(health, null, 2));
    } catch (error) {
      logger.error('Error serving health:', error);
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'error', message: 'Health check failed' }));
    }
  }
}

// Export singleton instance (not started by default)
export const metricsEndpoint = new MetricsEndpoint(
  parseInt(process.env.METRICS_PORT || '9090')
); 