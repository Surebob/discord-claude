/**
 * Token Management Configuration
 * Centralized settings for token counting, context management, and adaptive behavior
 */

/**
 * Token management and context settings
 */
export const TOKEN_MANAGEMENT = {
  CONTEXT_WINDOW_SIZE: 200000, // Claude 3.5 Sonnet context window
  SUMMARIZATION_THRESHOLD: 0.80, // Summarize at 80% of context window
  WARNING_THRESHOLD: 0.70, // Show warning at 70%
  EMERGENCY_THRESHOLD: 0.95, // Emergency summarize at 95%
} as const;

/**
 * Context management strategies and settings
 */
export const CONTEXT_MANAGEMENT = {
  // Message fetching strategy - determines how many messages to include
  STRATEGY: 'adaptive' as 'fixed' | 'adaptive' | 'unlimited',
  
  // FIXED STRATEGY (50 messages max)
  // ✅ Predictable performance & costs
  // ✅ Good for high-traffic channels  
  // ❌ May miss context in slow channels
  FIXED_MESSAGE_LIMIT: 50,
  
  // ADAPTIVE STRATEGY (Start 30, expand to 200 if tokens allow)
  // ✅ Balances performance & context retention
  // ✅ Efficient token usage
  // ✅ Good default for most use cases  
  ADAPTIVE_INITIAL_LIMIT: 30,
  ADAPTIVE_MAX_LIMIT: 200,
  
  // UNLIMITED STRATEGY (Fetch until token limit)
  // ✅ Maximum context retention
  // ✅ Always operates at optimal capacity
  // ❌ Always near token limits (higher costs)
  // ❌ Variable performance
  UNLIMITED_SAFETY_LIMIT: 1000, // Prevent infinite loops
  
  // Token budget allocation
  RESERVE_TOKENS_FOR_RESPONSE: 4000, // Keep tokens for Claude's response
  RESERVE_TOKENS_FOR_SYSTEM: 1000,   // Keep tokens for system prompt
} as const;

/**
 * Rate limiting configuration
 */
export const RATE_LIMITS = {
  CLAUDE_REQUESTS_PER_MINUTE: parseInt(process.env.CLAUDE_REQUESTS_PER_MINUTE || '50')
} as const;

/**
 * Calculate token usage percentages
 */
export function calculateTokenUsage(usedTokens: number): {
  percentage: number;
  shouldWarn: boolean;
  shouldSummarize: boolean;
  isEmergency: boolean;
} {
  const percentage = usedTokens / TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE;
  
  return {
    percentage,
    shouldWarn: percentage >= TOKEN_MANAGEMENT.WARNING_THRESHOLD,
    shouldSummarize: percentage >= TOKEN_MANAGEMENT.SUMMARIZATION_THRESHOLD,
    isEmergency: percentage >= TOKEN_MANAGEMENT.EMERGENCY_THRESHOLD
  };
}

/**
 * Calculate available tokens for different purposes
 */
export function calculateAvailableTokens(usedTokens: number): {
  totalAvailable: number;
  forResponse: number;
  forContext: number;
} {
  const totalAvailable = TOKEN_MANAGEMENT.CONTEXT_WINDOW_SIZE - usedTokens;
  const forResponse = Math.min(totalAvailable, CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_RESPONSE);
  const forContext = totalAvailable - CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_RESPONSE - CONTEXT_MANAGEMENT.RESERVE_TOKENS_FOR_SYSTEM;
  
  return {
    totalAvailable: Math.max(0, totalAvailable),
    forResponse: Math.max(0, forResponse),
    forContext: Math.max(0, forContext)
  };
} 