/**
 * Infrastructure Configuration Module
 * 
 * Centralized configuration management with clear separation of concerns:
 * - Environment variables and validation
 * - Claude AI settings and prompts
 * - Token management and context strategies
 * - Rate limiting and performance tuning
 * 
 * @example
 * ```typescript
 * import { config, CLAUDE_SETTINGS, TOKEN_MANAGEMENT } from '@/modules/infra/config';
 * 
 * // Access bot configuration
 * console.log(config.botName);
 * 
 * // Use Claude settings
 * const response = await claudeClient.messages.create({
 *   model: CLAUDE_SETTINGS.model,
 *   max_tokens: CLAUDE_SETTINGS.maxTokens,
 *   // ...
 * });
 * ```
 */

// Import environment first
import { 
  environment, 
  isDevelopment, 
  isProduction, 
  isTest,
  validateEnvironment 
} from './environment';

// Import domain configuration
import { 
  CLAUDE_SETTINGS,
  DELEGATE_CLAUDE_SETTINGS, 
  validateClaudeConfiguration
} from './claude-config';

import { 
  TOKEN_MANAGEMENT,
  CONTEXT_MANAGEMENT,
  RATE_LIMITS,
  calculateTokenUsage,
  calculateAvailableTokens 
} from './token-config';

// Export all domain configurations
export {
  CLAUDE_SETTINGS,
  DELEGATE_CLAUDE_SETTINGS,
  TOKEN_MANAGEMENT,
  CONTEXT_MANAGEMENT,
  RATE_LIMITS,
  calculateTokenUsage,
  calculateAvailableTokens,
  validateClaudeConfiguration
};

// Export environment configuration
export { 
  environment, 
  isDevelopment, 
  isProduction, 
  isTest,
  validateEnvironment 
};

// Legacy compatibility - matches old config interface
export const config = {
  token: environment.discordToken,
  clientId: environment.discordClientId,
  anthropicApiKey: environment.anthropicApiKey,
  botName: environment.botName,
  enableMentionResponses: environment.enableMentionResponses,
} as const;

// Legacy exports for backward compatibility
export const logLevel = environment.logLevel;

// Export Discord configuration
export {
  DISCORD_CONFIG,
  SUPPORTED_CHANNEL_TYPES,
  REQUIRED_PERMISSIONS,
  DISCORD_ERROR_CODES,
  DISCORD_LIMITS,
  validateDiscordConfiguration,
  getBotInviteUrl,
  isSupportedChannelType,
  getDiscordErrorMessage,
  calculateMessageSplitPoints
} from './discord-config';

// Export Database configuration
export {
  DATABASE_CONFIG,
  DATABASE_SCHEMA,
  DATABASE_PERFORMANCE,
  DATABASE_HEALTH_CHECK,
  validateDatabaseConfiguration,
  getDatabaseUrl,
  getConnectionParams,
  isManagedDatabase,
  getOptimalConfiguration
} from './database-config';

// Export Configuration Manager
export {
  ConfigurationManager,
  configManager,
  initializeConfiguration,
  getConfigurationStatus,
  type ConfigurationValidationResult
} from './config-manager';

/**
 * Configuration validation - run all validations (updated)
 */
export function validateAllConfiguration(): void {
  validateEnvironment();
  validateClaudeConfiguration();
  // TODO: Add these imports once the modules are available
  // validateDiscordConfiguration();
  // validateDatabaseConfiguration();
} 