import { environment } from './environment';

/**
 * Discord Configuration
 * Centralized settings for Discord API integration
 */

/**
 * Discord bot settings
 */
export const DISCORD_CONFIG = {
  // Required settings
  token: environment.discordToken,
  clientId: environment.discordClientId,
  
  // Bot behavior settings
  botName: environment.botName,
  enableMentionResponses: environment.enableMentionResponses,
  
  // Discord API settings
  apiVersion: '10',
  apiUrl: 'https://discord.com/api',
  
  // Gateway settings
  intents: [
    'Guilds',
    'GuildMessages', 
    'MessageContent',
    'DirectMessages',
    'GuildMembers'
  ] as const,
  
  partials: [
    'Channel', // Required for DM support
    'Message'
  ] as const,
  
  // Connection settings
  connectionTimeout: 30000,
  reconnectTimeout: 5000,
  maxReconnectAttempts: 10,
  
  // Message settings
  messageMaxLength: 2000,
  embedMaxLength: 6000,
  embedMaxFields: 25,
  
  // Rate limiting settings
  requestsPerSecond: 50,
  burstLimit: 5,
  
  // Activity settings
  activityType: 'Custom' as const,
  activityName: `${environment.botName} | Ready to help!`,
  
  // Slash command settings
  commandDeployment: {
    global: true,
    guildSpecific: false,
    deleteUnknown: true
  }
} as const;

/**
 * Discord channel types supported by the bot
 */
export const SUPPORTED_CHANNEL_TYPES = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_PUBLIC_THREAD: 11,
  GUILD_PRIVATE_THREAD: 12,
  GUILD_NEWS_THREAD: 10
} as const;

/**
 * Discord permission flags the bot requires
 */
export const REQUIRED_PERMISSIONS = {
  // Basic permissions
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  
  // Thread permissions
  CREATE_PUBLIC_THREADS: 1n << 34n,
  CREATE_PRIVATE_THREADS: 1n << 35n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  
  // File permissions
  ATTACH_FILES: 1n << 15n,
  EMBED_LINKS: 1n << 14n,
  
  // Optional permissions
  ADD_REACTIONS: 1n << 6n,
  USE_EXTERNAL_EMOJIS: 1n << 18n
} as const;

/**
 * Discord error codes that we handle specially
 */
export const DISCORD_ERROR_CODES = {
  UNKNOWN_MESSAGE: 10008,
  UNKNOWN_CHANNEL: 10003,
  UNKNOWN_GUILD: 10004,
  UNKNOWN_USER: 10013,
  MISSING_ACCESS: 50001,
  MISSING_PERMISSIONS: 50013,
  MESSAGE_TOO_LONG: 50035,
  RATE_LIMITED: 429
} as const;

/**
 * Discord limits and constraints
 */
export const DISCORD_LIMITS = {
  MESSAGE: {
    CONTENT_MAX: 2000,
    EMBED_TITLE_MAX: 256,
    EMBED_DESCRIPTION_MAX: 4096,
    EMBED_FIELD_NAME_MAX: 256,
    EMBED_FIELD_VALUE_MAX: 1024,
    EMBED_FOOTER_MAX: 2048,
    EMBED_AUTHOR_NAME_MAX: 256
  },
  
  THREAD: {
    NAME_MAX: 100,
    AUTO_ARCHIVE_DURATION: [60, 1440, 4320, 10080], // minutes
    DEFAULT_AUTO_ARCHIVE: 1440 // 24 hours
  },
  
  ATTACHMENT: {
    SIZE_MAX: 25 * 1024 * 1024, // 25MB for regular users
    SIZE_MAX_NITRO: 500 * 1024 * 1024, // 500MB for Nitro users
    COUNT_MAX: 10
  },
  
  RATE_LIMITS: {
    MESSAGE_CREATE: 5, // per 5 seconds
    THREAD_CREATE: 10, // per hour
    SLASH_COMMANDS: 5 // per second
  }
} as const;

/**
 * Validate Discord configuration
 */
export function validateDiscordConfiguration(): void {
  if (!DISCORD_CONFIG.token) {
    throw new Error('Discord token is required');
  }
  
  if (!DISCORD_CONFIG.clientId) {
    throw new Error('Discord client ID is required');
  }
  
  // Validate token format (Discord tokens have a specific format)
  if (!DISCORD_CONFIG.token.match(/^[A-Za-z0-9._-]+$/)) {
    console.warn('⚠️ Discord token format may be invalid');
  }
  
  // Validate client ID format (Discord snowflake)
  if (!DISCORD_CONFIG.clientId.match(/^\d{17,19}$/)) {
    throw new Error('Discord client ID must be a valid snowflake (17-19 digits)');
  }
  
  console.log(`🤖 Discord bot configured: ${DISCORD_CONFIG.botName} (${DISCORD_CONFIG.clientId})`);
}

/**
 * Get invite URL for the bot with required permissions
 */
export function getBotInviteUrl(guildId?: string): string {
  const permissions = Object.values(REQUIRED_PERMISSIONS)
    .reduce((sum, perm) => sum | perm, 0n)
    .toString();
    
  const baseUrl = `https://discord.com/oauth2/authorize`;
  const params = new URLSearchParams({
    client_id: DISCORD_CONFIG.clientId,
    permissions,
    scope: 'bot applications.commands'
  });
  
  if (guildId) {
    params.set('guild_id', guildId);
  }
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Check if a channel type is supported by the bot
 */
export function isSupportedChannelType(type: number): type is 0 | 1 | 10 | 11 | 12 {
  return Object.values(SUPPORTED_CHANNEL_TYPES).includes(type as any);
}

/**
 * Get user-friendly error message for Discord error codes
 */
export function getDiscordErrorMessage(code: number): string {
  switch (code) {
    case DISCORD_ERROR_CODES.UNKNOWN_MESSAGE:
      return 'Message not found or deleted';
    case DISCORD_ERROR_CODES.UNKNOWN_CHANNEL:
      return 'Channel not found or bot lacks access';
    case DISCORD_ERROR_CODES.UNKNOWN_GUILD:
      return 'Server not found or bot not in server';
    case DISCORD_ERROR_CODES.UNKNOWN_USER:
      return 'User not found';
    case DISCORD_ERROR_CODES.MISSING_ACCESS:
      return 'Bot lacks access to this resource';
    case DISCORD_ERROR_CODES.MISSING_PERMISSIONS:
      return 'Bot lacks required permissions';
    case DISCORD_ERROR_CODES.MESSAGE_TOO_LONG:
      return 'Message content too long';
    case DISCORD_ERROR_CODES.RATE_LIMITED:
      return 'Rate limited - please try again later';
    default:
      return `Discord API error (${code})`;
  }
}

/**
 * Calculate optimal message split points for long content
 */
export function calculateMessageSplitPoints(content: string, maxLength: number = DISCORD_LIMITS.MESSAGE.CONTENT_MAX): string[] {
  if (content.length <= maxLength) {
    return [content];
  }
  
  const chunks: string[] = [];
  let currentChunk = '';
  
  // Split by lines first to preserve formatting
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 <= maxLength) {
      currentChunk += (currentChunk ? '\n' : '') + line;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      // If single line is too long, split by words
      if (line.length > maxLength) {
        const words = line.split(' ');
        let wordChunk = '';
        
        for (const word of words) {
          if (wordChunk.length + word.length + 1 <= maxLength) {
            wordChunk += (wordChunk ? ' ' : '') + word;
          } else {
            if (wordChunk) {
              chunks.push(wordChunk);
              wordChunk = word;
            } else {
              // Single word too long, force split
              chunks.push(word.substring(0, maxLength));
              wordChunk = word.substring(maxLength);
            }
          }
        }
        
        if (wordChunk) {
          currentChunk = wordChunk;
        }
      } else {
        currentChunk = line;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
} 