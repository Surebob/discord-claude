import { EmbedBuilder, ColorResolvable, APIEmbedField } from 'discord.js';
import { config } from '../../infra/config';

/**
 * Discord Embed Builder
 * Utility for creating rich Discord embeds with consistent styling
 */
export class DiscordEmbedBuilder {
  
  /**
   * Create a basic embed with default styling
   */
  static createBasic(title?: string, description?: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(this.getDefaultColor())
      .setTimestamp();

    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);

    return embed;
  }

  /**
   * Create an info embed (blue)
   */
  static createInfo(title: string, description?: string): EmbedBuilder {
    return this.createBasic(title, description)
      .setColor('#3498db'); // Blue
  }

  /**
   * Create a success embed (green)
   */
  static createSuccess(title: string, description?: string): EmbedBuilder {
    return this.createBasic(title, description)
      .setColor('#2ecc71'); // Green
  }

  /**
   * Create a warning embed (yellow)
   */
  static createWarning(title: string, description?: string): EmbedBuilder {
    return this.createBasic(title, description)
      .setColor('#f39c12'); // Orange
  }

  /**
   * Create an error embed (red)
   */
  static createError(title: string, description?: string): EmbedBuilder {
    return this.createBasic(title, description)
      .setColor('#e74c3c'); // Red
  }

  /**
   * Create a Claude AI response embed
   */
  static createClaudeResponse(content: string, metadata?: {
    model?: string;
    tokensUsed?: number;
    responseTime?: number;
    webSearchUsed?: boolean;
  }): EmbedBuilder {
    const embed = this.createBasic('Claude AI Response')
      .setDescription(content.length > 4000 ? content.substring(0, 4000) + '...' : content)
      .setColor('#8b5cf6'); // Purple for Claude

    if (metadata) {
      const fields: APIEmbedField[] = [];

      if (metadata.model) {
        fields.push({ name: '🤖 Model', value: metadata.model, inline: true });
      }

      if (metadata.tokensUsed) {
        fields.push({ name: '🔢 Tokens', value: metadata.tokensUsed.toString(), inline: true });
      }

      if (metadata.responseTime) {
        fields.push({ name: '⏱️ Response Time', value: `${metadata.responseTime}ms`, inline: true });
      }

      if (metadata.webSearchUsed) {
        fields.push({ name: '🌐 Web Search', value: 'Enabled', inline: true });
      }

      if (fields.length > 0) {
        embed.addFields(fields);
      }
    }

    return embed;
  }

  /**
   * Create a thread summary embed
   */
  static createThreadSummary(threadName: string, summary: string, stats?: {
    messageCount?: number;
    participantCount?: number;
    createdAt?: Date;
  }): EmbedBuilder {
    const embed = this.createInfo(`🧵 Thread Summary: ${threadName}`)
      .setDescription(summary);

    if (stats) {
      const fields: APIEmbedField[] = [];

      if (stats.messageCount) {
        fields.push({ name: '💬 Messages', value: stats.messageCount.toString(), inline: true });
      }

      if (stats.participantCount) {
        fields.push({ name: '👥 Participants', value: stats.participantCount.toString(), inline: true });
      }

      if (stats.createdAt) {
        fields.push({ name: '📅 Created', value: `<t:${Math.floor(stats.createdAt.getTime() / 1000)}:R>`, inline: true });
      }

      if (fields.length > 0) {
        embed.addFields(fields);
      }
    }

    return embed;
  }

  /**
   * Create a rate limit embed
   */
  static createRateLimit(resetTime: Date, requestsRemaining?: number): EmbedBuilder {
    const resetTimestamp = Math.round(resetTime.getTime() / 1000);
    
    let description = `You're sending requests too quickly. Please wait until <t:${resetTimestamp}:R>.`;
    
    if (requestsRemaining !== undefined) {
      description += `\n\n**Requests remaining:** ${requestsRemaining}`;
    }

    return this.createWarning('⏰ Rate Limited', description);
  }

  /**
   * Create a help embed
   */
  static createHelp(): EmbedBuilder {
    return this.createInfo('🤖 Claude AI Assistant', 
      `I'm Claude, an AI assistant here to help you!\n\n` +
      `**How to interact with me:**\n` +
      `• Mention me: @${config.botName}\n` +
      `• Use slash commands: \`/claude\`\n` +
      `• I work in DMs and servers\n\n` +
      `**Features:**\n` +
      `• Natural conversation\n` +
      `• File analysis (images, PDFs, text)\n` +
      `• Web search capabilities\n` +
      `• Thread management\n` +
      `• Context-aware responses`
    )
    .setThumbnail('https://cdn.discordapp.com/avatars/bot-id/avatar.png') // Would need actual bot avatar
    .addFields([
      { name: '🔗 Useful Commands', value: '`/claude` - Ask me anything', inline: false },
      { name: '📚 More Info', value: 'Just mention me in any message!', inline: false }
    ]);
  }

  /**
   * Create a status embed
   */
  static createStatus(status: {
    uptime?: number;
    guilds?: number;
    channels?: number;
    users?: number;
    apiLatency?: number;
    memoryUsage?: number;
  }): EmbedBuilder {
    const embed = this.createInfo('📊 Bot Status');

    const fields: APIEmbedField[] = [];

    if (status.uptime) {
      const days = Math.floor(status.uptime / (24 * 60 * 60));
      const hours = Math.floor((status.uptime % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((status.uptime % (60 * 60)) / 60);
      fields.push({ name: '⏰ Uptime', value: `${days}d ${hours}h ${minutes}m`, inline: true });
    }

    if (status.guilds) {
      fields.push({ name: '🏠 Servers', value: status.guilds.toString(), inline: true });
    }

    if (status.apiLatency) {
      fields.push({ name: '📡 API Latency', value: `${status.apiLatency}ms`, inline: true });
    }

    if (status.users) {
      fields.push({ name: '👥 Users', value: status.users.toString(), inline: true });
    }

    if (status.memoryUsage) {
      const mb = Math.round(status.memoryUsage / 1024 / 1024);
      fields.push({ name: '💾 Memory', value: `${mb} MB`, inline: true });
    }

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    return embed;
  }

  /**
   * Create a file processing embed
   */
  static createFileProcessing(fileName: string, fileType: string, status: 'processing' | 'completed' | 'error', details?: string): EmbedBuilder {
    let embed: EmbedBuilder;
    
    switch (status) {
      case 'processing':
        embed = this.createInfo('📎 Processing File', `**${fileName}**\n\nAnalyzing ${fileType} file...`);
        break;
      case 'completed':
        embed = this.createSuccess('✅ File Processed', `**${fileName}**\n\nSuccessfully analyzed ${fileType} file.`);
        break;
      case 'error':
        embed = this.createError('❌ File Processing Error', `**${fileName}**\n\nFailed to process ${fileType} file.`);
        break;
    }

    if (details) {
      embed.addFields([{ name: 'Details', value: details, inline: false }]);
    }

    return embed;
  }

  /**
   * Create a search result embed
   */
  static createSearchResult(query: string, results: Array<{title: string, url: string, snippet: string}>): EmbedBuilder {
    const embed = this.createInfo(`🔍 Search Results for: "${query}"`)
      .setDescription(`Found ${results.length} result(s)`);

    results.slice(0, 5).forEach((result, index) => {
      embed.addFields([{
        name: `${index + 1}. ${result.title}`,
        value: `${result.snippet}\n[🔗 Read more](${result.url})`,
        inline: false
      }]);
    });

    return embed;
  }

  /**
   * Get default embed color
   */
  private static getDefaultColor(): ColorResolvable {
    return '#5865f2'; // Discord blurple
  }

  /**
   * Truncate text to fit embed limits
   */
  static truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Split large content into multiple embeds
   */
  static splitLargeContent(content: string, title: string, maxLength = 4000): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];
    const chunks = this.chunkText(content, maxLength);

    chunks.forEach((chunk, index) => {
      const embed = this.createBasic(
        index === 0 ? title : `${title} (continued ${index + 1})`,
        chunk
      );
      embeds.push(embed);
    });

    return embeds;
  }

  /**
   * Split text into chunks
   */
  private static chunkText(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const lines = text.split('\n');
    
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        
        // If single line is too long, force split
        if (line.length > maxLength) {
          let remaining = line;
          while (remaining.length > maxLength) {
            chunks.push(remaining.substring(0, maxLength));
            remaining = remaining.substring(maxLength);
          }
          currentChunk = remaining;
        } else {
          currentChunk = line;
        }
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
} 