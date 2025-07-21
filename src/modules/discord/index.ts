/**
 * Discord Integration Module
 * 
 * Complete Discord API integration with modular architecture:
 * - Client lifecycle management
 * - Message and slash command handling
 * - Thread event management
 * - File attachment processing
 * - Message splitting utilities
 * - Rich embed creation
 * - Reaction management
 * - AI integration through handlers
 * 
 * @example
 * ```typescript
 * import { 
 *   DiscordClient, 
 *   MessageHandler, 
 *   ThreadHandler,
 *   DiscordEmbedBuilder,
 *   ReactionManager,
 *   AIService 
 * } from '@/modules/discord';
 * import { container } from '@/core';
 * 
 * // Use DI container to get Discord client
 * const discordClient = await container.resolve<DiscordClient>('discordClient');
 * await discordClient.login();
 * ```
 */

// Export classes
export { DiscordClient } from './client';
export { MessageHandler } from './handlers/message-handler';
export { SlashHandler } from './handlers/slash-handler';
export { ThreadHandler } from './handlers/thread-handler';

// Export formatters and utilities
export { MessageSplitter } from './formatters/message-splitter';
export { DiscordEmbedBuilder } from './formatters/embed-builder';
export { ReactionManager } from './formatters/reaction-manager';

// Export types
export type { 
  AIService, 
  SupportedChannel, 
  DiscordContext, 
  DiscordClientConfig 
} from './types';

// NOTE: No global singleton exported - use DI container to resolve DiscordClient
// Example: const discordClient = await container.resolve<DiscordClient>('discordClient'); 