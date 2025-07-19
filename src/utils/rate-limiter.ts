import { RateLimiterMemory } from 'rate-limiter-flexible';
import { RATE_LIMITS } from '@/config/index.js';
import { RateLimitInfo } from '@/types/index.js';
import { logger } from './logger.js';

// Only Claude rate limiter - message limiting not used
const claudeLimiter = new RateLimiterMemory({
  points: RATE_LIMITS.CLAUDE_REQUESTS_PER_MINUTE,
  duration: 60,
  blockDuration: 120, // block for 2 minutes for Claude requests
});

export class RateLimitService {
  /**
   * Check if a Claude request can be made
   */
  async checkClaudeLimit(userId: string): Promise<RateLimitInfo> {
    try {
      const result = await claudeLimiter.consume(userId);
      return {
        remaining: result.remainingPoints || 0,
        resetTime: new Date(Date.now() + result.msBeforeNext),
        isLimited: false
      };
    } catch (rejRes: unknown) {
      logger.warn(`Claude rate limit exceeded for user ${userId}`);
      const rejection = rejRes as { msBeforeNext: number };
      return {
        remaining: 0,
        resetTime: new Date(Date.now() + rejection.msBeforeNext),
        isLimited: true
      };
    }
  }
}

export const rateLimitService = new RateLimitService(); 