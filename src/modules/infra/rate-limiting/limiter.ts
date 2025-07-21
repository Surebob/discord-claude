import { RateLimiterMemory } from 'rate-limiter-flexible';
import { RATE_LIMITS } from '../config';
import { logger } from '../logging';

/**
 * Rate Limiting Infrastructure
 * Centralized rate limiting for external API calls and resource protection
 */

/**
 * Rate limit information interface
 */
export interface RateLimitInfo {
  remaining: number;
  resetTime: Date;
  isLimited: boolean;
}

/**
 * Claude API rate limiter configuration
 */
const claudeLimiter = new RateLimiterMemory({
  points: RATE_LIMITS.CLAUDE_REQUESTS_PER_MINUTE,
  duration: 60, // 1 minute window
  blockDuration: 120, // Block for 2 minutes when limit exceeded
});

/**
 * Rate Limiting Service
 * Manages rate limits for different external services and resources
 */
export class RateLimitService {
  /**
   * Check if a Claude API request can be made for a user
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
      logger.warn(`Claude rate limit exceeded for user ${userId}`, {
        userId,
        type: 'RATE_LIMIT_EXCEEDED',
        service: 'claude'
      });
      
      const rejection = rejRes as { msBeforeNext: number };
      
      return {
        remaining: 0,
        resetTime: new Date(Date.now() + rejection.msBeforeNext),
        isLimited: true
      };
    }
  }

  /**
   * Get current rate limit status without consuming a point
   */
  async getClaudeStatus(userId: string): Promise<RateLimitInfo> {
    try {
      const result = await claudeLimiter.get(userId);
      
      if (!result) {
        return {
          remaining: RATE_LIMITS.CLAUDE_REQUESTS_PER_MINUTE,
          resetTime: new Date(Date.now() + 60000), // 1 minute from now
          isLimited: false
        };
      }

      return {
        remaining: result.remainingPoints || 0,
        resetTime: new Date(Date.now() + result.msBeforeNext),
        isLimited: result.remainingPoints === 0
      };
    } catch (error) {
      logger.error('Failed to get rate limit status', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        type: 'RATE_LIMIT_STATUS_ERROR'
      });
      
      // Return conservative status on error
      return {
        remaining: 0,
        resetTime: new Date(Date.now() + 60000),
        isLimited: true
      };
    }
  }

  /**
   * Reset rate limit for a user (admin function)
   */
  async resetClaudeLimit(userId: string): Promise<void> {
    try {
      await claudeLimiter.delete(userId);
      logger.info(`Rate limit reset for user ${userId}`, {
        userId,
        type: 'RATE_LIMIT_RESET',
        service: 'claude'
      });
    } catch (error) {
      logger.error('Failed to reset rate limit', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        type: 'RATE_LIMIT_RESET_ERROR'
      });
      throw error;
    }
  }
}

/**
 * Singleton rate limit service instance
 */
export const rateLimitService = new RateLimitService(); 