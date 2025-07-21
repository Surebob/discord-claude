import dotenv from 'dotenv';

/**
 * Environment Variables Configuration
 * Centralized environment variable loading and validation
 */

// Load environment variables from .env file
dotenv.config();

/**
 * Required environment variables that must be present
 */
const REQUIRED_ENV_VARS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID', 
  'ANTHROPIC_API_KEY'
] as const;

/**
 * Validate that all required environment variables are present
 * @throws Error if any required variables are missing
 */
export function validateEnvironment(): void {
  const missing = REQUIRED_ENV_VARS.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Environment configuration with defaults
 */
export const environment = {
  // Required variables
  discordToken: process.env.DISCORD_TOKEN!,
  discordClientId: process.env.DISCORD_CLIENT_ID!,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  
  // Optional variables with defaults
  botName: process.env.BOT_NAME || 'Claude',
  enableMentionResponses: process.env.ENABLE_MENTION_RESPONSES !== 'false',
  
  // Environment detection
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // AI Model configuration
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  delegateClaudeModel: process.env.DELEGATE_CLAUDE_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  maxTokensPerRequest: parseInt(process.env.MAX_TOKENS_PER_REQUEST || '64000'),
  delegateMaxTokens: parseInt(process.env.DELEGATE_MAX_TOKENS || '8000'),
  
  // Rate limiting
  claudeRequestsPerMinute: parseInt(process.env.CLAUDE_REQUESTS_PER_MINUTE || '50'),
} as const;

/**
 * Derived environment properties
 */
export const isDevelopment = environment.nodeEnv === 'development';
export const isProduction = environment.nodeEnv === 'production';
export const isTest = environment.nodeEnv === 'test';

// Validate environment on module load
validateEnvironment(); 