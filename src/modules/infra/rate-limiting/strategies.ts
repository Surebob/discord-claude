import { logger } from '../logging';

/**
 * Rate limiting strategy interface
 */
export interface RateLimitStrategy {
  checkLimit(key: string, weight?: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  getStats(key: string): Promise<RateLimitStats | null>;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

/**
 * Rate limit statistics
 */
export interface RateLimitStats {
  requests: number;
  remaining: number;
  resetTime: Date;
  windowStart: Date;
}

/**
 * Token Bucket Strategy
 * Good for allowing bursts up to a limit while maintaining average rate
 */
export class TokenBucketStrategy implements RateLimitStrategy {
  private buckets = new Map<string, {
    tokens: number;
    lastRefill: number;
    requests: number;
  }>();

  constructor(
    private capacity: number,     // Maximum tokens in bucket
    private refillRate: number,   // Tokens added per second
    private windowMs: number = 60000 // Window for tracking (1 minute)
  ) {
    logger.debug(`Token bucket strategy initialized`, {
      capacity,
      refillRate,
      windowMs
    });
  }

  async checkLimit(key: string, weight: number = 1): Promise<RateLimitResult> {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: now,
        requests: 0
      };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const timeDelta = (now - bucket.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = Math.floor(timeDelta * this.refillRate);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    // Check if we have enough tokens
    const allowed = bucket.tokens >= weight;
    
    if (allowed) {
      bucket.tokens -= weight;
      bucket.requests++;
    }

    // Calculate reset time (when bucket will be full again)
    const tokensNeeded = this.capacity - bucket.tokens;
    const timeToFull = tokensNeeded / this.refillRate * 1000; // Convert to ms
    const resetTime = new Date(now + timeToFull);

    // Calculate retry after if request was denied
    let retryAfter: number | undefined;
    if (!allowed) {
      const tokensNeededForRequest = weight - bucket.tokens;
      retryAfter = Math.ceil(tokensNeededForRequest / this.refillRate * 1000);
    }

    return {
      allowed,
      limit: this.capacity,
      remaining: bucket.tokens,
      resetTime,
      retryAfter
    };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
    logger.debug(`Token bucket reset for key: ${key}`);
  }

  async getStats(key: string): Promise<RateLimitStats | null> {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;

    return {
      requests: bucket.requests,
      remaining: bucket.tokens,
      resetTime: new Date(bucket.lastRefill + this.windowMs),
      windowStart: new Date(bucket.lastRefill)
    };
  }
}

/**
 * Sliding Window Log Strategy
 * Maintains a log of request timestamps for precise rate limiting
 */
export class SlidingWindowLogStrategy implements RateLimitStrategy {
  private windows = new Map<string, {
    requests: number[];
    totalRequests: number;
  }>();

  constructor(
    private limit: number,        // Maximum requests in window
    private windowMs: number      // Time window in milliseconds
  ) {
    logger.debug(`Sliding window log strategy initialized`, {
      limit,
      windowMs
    });
  }

  async checkLimit(key: string, weight: number = 1): Promise<RateLimitResult> {
    const now = Date.now();
    let window = this.windows.get(key);

    if (!window) {
      window = {
        requests: [],
        totalRequests: 0
      };
      this.windows.set(key, window);
    }

    // Clean up old requests outside the window
    const cutoff = now - this.windowMs;
    window.requests = window.requests.filter(timestamp => timestamp > cutoff);

    // Check if adding this request would exceed limit
    const currentCount = window.requests.length;
    const allowed = currentCount + weight <= this.limit;

    if (allowed) {
      // Add timestamps for the weighted request
      for (let i = 0; i < weight; i++) {
        window.requests.push(now);
      }
      window.totalRequests += weight;
    }

    const remaining = Math.max(0, this.limit - window.requests.length);
    const resetTime = new Date(now + this.windowMs);

    // Calculate retry after if request was denied
    let retryAfter: number | undefined;
    if (!allowed && window.requests.length > 0) {
      const oldestRequest = Math.min(...window.requests);
      retryAfter = Math.max(0, oldestRequest + this.windowMs - now);
    }

    return {
      allowed,
      limit: this.limit,
      remaining,
      resetTime,
      retryAfter
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
    logger.debug(`Sliding window log reset for key: ${key}`);
  }

  async getStats(key: string): Promise<RateLimitStats | null> {
    const window = this.windows.get(key);
    if (!window) return null;

    const now = Date.now();
    const cutoff = now - this.windowMs;
    const activeRequests = window.requests.filter(timestamp => timestamp > cutoff);

    return {
      requests: activeRequests.length,
      remaining: Math.max(0, this.limit - activeRequests.length),
      resetTime: new Date(now + this.windowMs),
      windowStart: new Date(cutoff)
    };
  }
}

/**
 * Fixed Window Counter Strategy
 * Simple counter that resets at fixed intervals
 */
export class FixedWindowStrategy implements RateLimitStrategy {
  private windows = new Map<string, {
    count: number;
    windowStart: number;
  }>();

  constructor(
    private limit: number,        // Maximum requests per window
    private windowMs: number      // Window duration in milliseconds
  ) {
    logger.debug(`Fixed window strategy initialized`, {
      limit,
      windowMs
    });
  }

  async checkLimit(key: string, weight: number = 1): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    
    let window = this.windows.get(key);

    if (!window || window.windowStart !== windowStart) {
      // New window or window has reset
      window = {
        count: 0,
        windowStart
      };
      this.windows.set(key, window);
    }

    const allowed = window.count + weight <= this.limit;
    
    if (allowed) {
      window.count += weight;
    }

    const remaining = Math.max(0, this.limit - window.count);
    const resetTime = new Date(windowStart + this.windowMs);
    
    // Calculate retry after if request was denied
    let retryAfter: number | undefined;
    if (!allowed) {
      retryAfter = resetTime.getTime() - now;
    }

    return {
      allowed,
      limit: this.limit,
      remaining,
      resetTime,
      retryAfter
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
    logger.debug(`Fixed window reset for key: ${key}`);
  }

  async getStats(key: string): Promise<RateLimitStats | null> {
    const window = this.windows.get(key);
    if (!window) return null;

    const now = Date.now();
    const resetTime = new Date(window.windowStart + this.windowMs);

    return {
      requests: window.count,
      remaining: Math.max(0, this.limit - window.count),
      resetTime,
      windowStart: new Date(window.windowStart)
    };
  }
}

/**
 * Adaptive Rate Limiting Strategy
 * Adjusts limits based on system load and performance
 */
export class AdaptiveStrategy implements RateLimitStrategy {
  private baseStrategy: RateLimitStrategy;
  private currentLimit: number;
  private performanceHistory: number[] = [];
  private lastAdjustment: number = Date.now();

  constructor(
    baseStrategy: RateLimitStrategy,
    private baseLimit: number,
    private adjustmentIntervalMs: number = 60000, // 1 minute
    private loadThreshold: number = 0.8
  ) {
    this.baseStrategy = baseStrategy;
    this.currentLimit = baseLimit;
    
    logger.debug(`Adaptive strategy initialized`, {
      baseLimit,
      adjustmentIntervalMs,
      loadThreshold
    });
  }

  async checkLimit(key: string, weight: number = 1): Promise<RateLimitResult> {
    // Adjust limits based on performance if needed
    await this.adjustLimitsIfNeeded();

    const result = await this.baseStrategy.checkLimit(key, weight);
    
    // Override the limit in the result with our adaptive limit
    return {
      ...result,
      limit: this.currentLimit
    };
  }

  async reset(key: string): Promise<void> {
    return this.baseStrategy.reset(key);
  }

  async getStats(key: string): Promise<RateLimitStats | null> {
    return this.baseStrategy.getStats(key);
  }

  /**
   * Record performance metric for adaptive adjustment
   */
  recordPerformance(responseTime: number): void {
    this.performanceHistory.push(responseTime);
    
    // Keep only recent history (last 100 measurements)
    if (this.performanceHistory.length > 100) {
      this.performanceHistory.shift();
    }
  }

  /**
   * Adjust limits based on system performance
   */
  private async adjustLimitsIfNeeded(): Promise<void> {
    const now = Date.now();
    
    if (now - this.lastAdjustment < this.adjustmentIntervalMs) {
      return; // Too soon to adjust
    }

    if (this.performanceHistory.length < 10) {
      return; // Not enough data
    }

    // Calculate average response time
    const avgResponseTime = this.performanceHistory.reduce((sum, time) => sum + time, 0) 
                           / this.performanceHistory.length;

    // Define performance thresholds (in milliseconds)
    const goodPerformance = 1000;  // < 1 second
    const poorPerformance = 5000;  // > 5 seconds

    let adjustment = 0;

    if (avgResponseTime < goodPerformance) {
      // System performing well, can increase limits
      adjustment = Math.ceil(this.baseLimit * 0.1); // Increase by 10%
    } else if (avgResponseTime > poorPerformance) {
      // System struggling, decrease limits
      adjustment = -Math.ceil(this.baseLimit * 0.2); // Decrease by 20%
    }

    if (adjustment !== 0) {
      const newLimit = Math.max(1, this.currentLimit + adjustment);
      const change = newLimit - this.currentLimit;
      
      this.currentLimit = newLimit;
      this.lastAdjustment = now;
      
      logger.info(`Adaptive rate limit adjusted`, {
        oldLimit: this.currentLimit - change,
        newLimit: this.currentLimit,
        avgResponseTime,
        adjustment: change
      });
    }
  }
}

/**
 * Composite Strategy
 * Combines multiple strategies for sophisticated rate limiting
 */
export class CompositeStrategy implements RateLimitStrategy {
  constructor(
    private strategies: RateLimitStrategy[],
    private mode: 'all' | 'any' = 'all' // 'all' = all must pass, 'any' = any can pass
  ) {
    logger.debug(`Composite strategy initialized with ${strategies.length} strategies`, { mode });
  }

  async checkLimit(key: string, weight: number = 1): Promise<RateLimitResult> {
    const results = await Promise.all(
      this.strategies.map(strategy => strategy.checkLimit(key, weight))
    );

    if (this.mode === 'all') {
      // All strategies must allow the request
      const allowed = results.every(result => result.allowed);
      const mostRestrictive = results.reduce((most, current) => 
        current.remaining < most.remaining ? current : most
      );

      return {
        allowed,
        limit: mostRestrictive.limit,
        remaining: mostRestrictive.remaining,
        resetTime: mostRestrictive.resetTime,
        retryAfter: allowed ? undefined : Math.max(...results.map(r => r.retryAfter || 0))
      };
    } else {
      // Any strategy can allow the request
      const allowed = results.some(result => result.allowed);
      const leastRestrictive = results.reduce((least, current) => 
        current.remaining > least.remaining ? current : least
      );

      return {
        allowed,
        limit: leastRestrictive.limit,
        remaining: leastRestrictive.remaining,
        resetTime: leastRestrictive.resetTime,
        retryAfter: allowed ? undefined : Math.min(...results.map(r => r.retryAfter || Infinity))
      };
    }
  }

  async reset(key: string): Promise<void> {
    await Promise.all(this.strategies.map(strategy => strategy.reset(key)));
  }

  async getStats(key: string): Promise<RateLimitStats | null> {
    const stats = await Promise.all(
      this.strategies.map(strategy => strategy.getStats(key))
    );

    const validStats = stats.filter(stat => stat !== null) as RateLimitStats[];
    if (validStats.length === 0) return null;

    // Return aggregated stats
    return {
      requests: Math.max(...validStats.map(s => s.requests)),
      remaining: Math.min(...validStats.map(s => s.remaining)),
      resetTime: new Date(Math.max(...validStats.map(s => s.resetTime.getTime()))),
      windowStart: new Date(Math.min(...validStats.map(s => s.windowStart.getTime())))
    };
  }
} 