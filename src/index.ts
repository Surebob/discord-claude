import { discordClient } from '@/client/discord-client.js';
import { databaseService } from '@/services/database.js';
import { logger } from '@/utils/logger.js';

async function main() {
  try {
    // Initialize database connection
    await databaseService.connect();
    
    // Login to Discord - bot uses @mentions only
    await discordClient.login();
    
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
main(); 