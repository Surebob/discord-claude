/**
 * AI Processing Module
 * 
 * Pure AI service implementation for the modular architecture:
 * - Claude API integration without global dependencies
 * - Full AIService interface implementation
 * - Smart context processing with repository data
 * - Token management and optimization
 * 
 * @example
 * ```typescript
 * import { ClaudeAIService } from '@/modules/ai';
 * import { container } from '@/core';
 * 
 * // Register AI service in DI container
 * container.register('aiService', ClaudeAIService);
 * 
 * // Use via DI
 * const aiService = await container.resolve<ClaudeAIService>('aiService');
 * const response = await aiService.processWithSmartContext(prompt, context);
 * ```
 */

// Export AI service
export { ClaudeAIService } from './claude-service'; 