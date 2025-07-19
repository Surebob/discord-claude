import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from '@/config/index.js';
import { logger } from '@/utils/logger.js';

// Define slash commands for user app support
const commands = [
  new SlashCommandBuilder()
    .setName('claude')
    .setDescription('Chat with Claude AI')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Your message to Claude')
        .setRequired(true)
    )
    .setIntegrationTypes([0, 1]) // Guild and User install
    .setContexts([0, 1, 2]), // Guild, Bot DM, Private Channel
];

const rest = new REST({ version: '10' }).setToken(config.token);

async function deployCommands() {
  try {
    logger.info(`🚀 Deploying ${commands.length} application (/) commands for hybrid user/guild app.`);

    // Deploy commands globally (works for both user and guild installs)
    const data = await rest.put(
      Routes.applicationCommands(config.clientId),
      { body: commands.map(command => command.toJSON()) },
    ) as unknown[];

    logger.info(`✅ Successfully deployed ${data.length} slash commands globally.`);
    logger.info(`💬 Bot supports both:`);
    logger.info(`   - Slash command (/claude) - works everywhere as user app`);
    logger.info(`   - @mentions - works in servers where bot is added`);

  } catch (error) {
    logger.error('❌ Error deploying commands:', error);
    process.exit(1);
  }
}

deployCommands(); 