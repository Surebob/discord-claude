import { logger } from '../logging';

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failing, requests rejected
  HALF_OPEN = 'half_open' // Testing if service recovered
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening
  recoveryTimeout: number;       // Time before trying half-open (ms)
  successThreshold: number;      // Successes needed to close from half-open
  timeout: number;               // Request timeout (ms)
  monitoringWindow: number;      // Time window for failure tracking (ms)
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  requests: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  stateChanges: number;
}

/**
 * Circuit breaker error
 */
export class CircuitBreakerError extends Error {
  constructor(serviceName: string, state: CircuitBreakerState) {
    super(`Circuit breaker for ${serviceName} is ${state} - request rejected`);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit Breaker Implementation
 * Provides resilience patterns for external service calls
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private requests: number = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private stateChanges: number = 0;
  private halfOpenStartTime?: number;
  private recentFailures: number[] = []; // Timestamps of recent failures
  
  constructor(
    private serviceName: string,
    private config: CircuitBreakerConfig
  ) {
    logger.debug(`Circuit breaker initialized for ${serviceName}`, config);
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.requests++;
    
    // Check if circuit breaker should reject the request
    if (this.shouldRejectRequest()) {
      logger.warn(`Circuit breaker rejected request for ${this.serviceName}`, {
        state: this.state,
        failures: this.failures,
        requests: this.requests
      });
      throw new CircuitBreakerError(this.serviceName, this.state);
    }

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(operation);
      
      // Record success
      this.onSuccess();
      return result;
      
    } catch (error) {
      // Record failure
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      requests: this.requests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      stateChanges: this.stateChanges
    };
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = undefined;
    this.lastSuccessTime = undefined;
    this.halfOpenStartTime = undefined;
    this.recentFailures = [];
    this.stateChanges++;
    
    logger.info(`Circuit breaker reset for ${this.serviceName}`);
  }

  /**
   * Force circuit breaker to open state
   */
  forceOpen(): void {
    this.changeState(CircuitBreakerState.OPEN);
    logger.warn(`Circuit breaker forced open for ${this.serviceName}`);
  }

  /**
   * Check if request should be rejected
   */
  private shouldRejectRequest(): boolean {
    const now = Date.now();
    
    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        return false; // Allow all requests
        
      case CircuitBreakerState.OPEN:
        // Check if recovery timeout has passed
        if (this.lastFailureTime && 
            (now - this.lastFailureTime) >= this.config.recoveryTimeout) {
          this.changeState(CircuitBreakerState.HALF_OPEN);
          this.halfOpenStartTime = now;
          return false; // Allow this request to test service
        }
        return true; // Reject request
        
      case CircuitBreakerState.HALF_OPEN:
        // In half-open, allow limited requests to test service
        return false;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    
    switch (this.state) {
      case CircuitBreakerState.HALF_OPEN:
        this.successes++;
        if (this.successes >= this.config.successThreshold) {
          this.changeState(CircuitBreakerState.CLOSED);
          this.failures = 0;
          this.successes = 0;
        }
        break;
        
      case CircuitBreakerState.CLOSED:
        // Reset failure count on success in closed state
        this.cleanupOldFailures();
        break;
    }
    
    logger.debug(`Circuit breaker success for ${this.serviceName}`, {
      state: this.state,
      successes: this.successes
    });
  }

  /**
   * Handle failed operation
   */
  private onFailure(error: unknown): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failures++;
    this.recentFailures.push(now);
    
    // Clean up old failures outside monitoring window
    this.cleanupOldFailures();
    
    logger.warn(`Circuit breaker failure for ${this.serviceName}`, {
      state: this.state,
      failures: this.failures,
      error: error instanceof Error ? error.message : String(error)
    });

    switch (this.state) {
      case CircuitBreakerState.CLOSED:
        // Check if we should open the circuit
        if (this.getRecentFailureCount() >= this.config.failureThreshold) {
          this.changeState(CircuitBreakerState.OPEN);
        }
        break;
        
      case CircuitBreakerState.HALF_OPEN:
        // Any failure in half-open goes back to open
        this.changeState(CircuitBreakerState.OPEN);
        this.successes = 0;
        break;
    }
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Change circuit breaker state
   */
  private changeState(newState: CircuitBreakerState): void {
    const oldState = this.state;
    this.state = newState;
    this.stateChanges++;
    
    logger.info(`Circuit breaker state changed for ${this.serviceName}`, {
      from: oldState,
      to: newState,
      failures: this.failures,
      requests: this.requests
    });
  }

  /**
   * Clean up failures outside the monitoring window
   */
  private cleanupOldFailures(): void {
    const now = Date.now();
    const cutoff = now - this.config.monitoringWindow;
    this.recentFailures = this.recentFailures.filter(time => time > cutoff);
  }

  /**
   * Get count of recent failures within monitoring window
   */
  private getRecentFailureCount(): number {
    this.cleanupOldFailures();
    return this.recentFailures.length;
  }
}

/**
 * Circuit Breaker Manager
 * Manages multiple circuit breakers for different services
 */
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();
  private defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    successThreshold: 3,
    timeout: 30000, // 30 seconds
    monitoringWindow: 300000 // 5 minutes
  };

  /**
   * Get or create circuit breaker for a service
   */
  getBreaker(
    serviceName: string, 
    config?: Partial<CircuitBreakerConfig>
  ): CircuitBreaker {
    let breaker = this.breakers.get(serviceName);
    
    if (!breaker) {
      const finalConfig = { ...this.defaultConfig, ...config };
      breaker = new CircuitBreaker(serviceName, finalConfig);
      this.breakers.set(serviceName, breaker);
      
      logger.info(`Created circuit breaker for ${serviceName}`, finalConfig);
    }
    
    return breaker;
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    serviceName: string,
    operation: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const breaker = this.getBreaker(serviceName, config);
    return await breaker.execute(operation);
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    
    for (const [serviceName, breaker] of this.breakers.entries()) {
      stats[serviceName] = breaker.getStats();
    }
    
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    logger.info('All circuit breakers reset');
  }

  /**
   * Get circuit breaker by name
   */
  getCircuitBreaker(serviceName: string): CircuitBreaker | undefined {
    return this.breakers.get(serviceName);
  }
}

// Export singleton manager
export const circuitBreakerManager = new CircuitBreakerManager(); 