/**
 * Infrastructure Rate Limiting Module
 * 
 * Centralized rate limiting system for external API calls and resource protection:
 * - Claude API rate limiting
 * - Rate limit status checking
 * - Administrative rate limit management
 * 
 * @example
 * ```typescript
 * import { rateLimitService } from '@/modules/infra/rate-limiting';
 * 
 * const limitInfo = await rateLimitService.checkClaudeLimit(userId);
 * if (limitInfo.isLimited) {
 *   console.log(`Rate limited until: ${limitInfo.resetTime}`);
 * }
 * ```
 */

// Export main rate limiting service
export { 
  RateLimitService, 
  rateLimitService,
  type RateLimitInfo 
} from './limiter';

// Export circuit breaker
export {
  CircuitBreaker,
  CircuitBreakerManager,
  circuitBreakerManager,
  CircuitBreakerState,
  CircuitBreakerError,
  type CircuitBreakerConfig,
  type CircuitBreakerStats
} from './circuit-breaker';

// Export rate limiting strategies
export {
  TokenBucketStrategy,
  SlidingWindowLogStrategy,
  FixedWindowStrategy,
  AdaptiveStrategy,
  CompositeStrategy,
  type RateLimitStrategy,
  type RateLimitResult,
  type RateLimitStats
} from './strategies';

// Export rate limiting constants
export { RATE_LIMITS } from '../config'; 