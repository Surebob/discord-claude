import { Message, Attachment } from 'discord.js';
import { logger } from '../infra/logging';

/**
 * File Processor
 * Handles Discord file attachments and converts them to Claude-compatible format
 */
export class FileProcessor {
  private readonly maxFileSize = 32 * 1024 * 1024; // 32MB (Claude's limit)

  /**
   * Process attachments with smart deduplication across message history
   */
  async processAttachmentsWithDeduplication(
    message: Message, 
    messageLimit?: number // Add message limit parameter
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }>> {
    const claudeContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }> = [];
    
    // Step 1: Collect ALL attachments from current message + recent history
    const allAttachments: { attachment: any; messageId: string; timestamp: number; isCurrentMessage: boolean }[] = [];
    
    // Add current message attachments (highest priority)
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        allAttachments.push({
          attachment,
          messageId: message.id,
          timestamp: message.createdTimestamp,
          isCurrentMessage: true
        });
        logger.info(`📎 Current message attachment: ${attachment.name} (${attachment.size} bytes)`);
      }
    }
    
    // Add recent message history attachments - using the SAME data source as messageHistory
    try {
      const limit = messageLimit || 21; // Use provided limit or default to 21
      const recentMessages = await message.channel.messages.fetch({ limit });
      logger.info(`🔍 Fetched ${recentMessages.size} messages for attachment scanning (limit: ${limit})`);
      
      let messagesWithAttachments = 0;
      for (const [, msg] of recentMessages) {
        if (msg.id !== message.id && msg.attachments.size > 0) {
          messagesWithAttachments++;
          for (const attachment of msg.attachments.values()) {
            allAttachments.push({
              attachment,
              messageId: msg.id,
              timestamp: msg.createdTimestamp,
              isCurrentMessage: false
            });
            logger.info(`📎 Found: ${attachment.name} (${attachment.size} bytes) from ${msg.id}`);
          }
        }
      }
      logger.info(`📊 Attachment scan: ${messagesWithAttachments} messages with attachments, ${recentMessages.size - messagesWithAttachments - 1} without`);
    } catch (error) {
      logger.warn('Could not fetch recent messages for attachment deduplication:', error);
    }
    
    // Step 2: Deduplicate by filename + size, keeping the newest
    logger.info(`🧮 Deduplicating ${allAttachments.length} total attachments...`);
    const fileMap = new Map<string, { attachment: any; messageId: string; timestamp: number; isCurrentMessage: boolean }>();
    
    let duplicatesSkipped = 0;
    for (const item of allAttachments) {
      const key = `${item.attachment.name}_${item.attachment.size}`;
      const existing = fileMap.get(key);
      
      if (!existing) {
        fileMap.set(key, item);
      } else {
        duplicatesSkipped++;
        // Keep the newer one (current message always wins, then by timestamp)
        if (item.isCurrentMessage && !existing.isCurrentMessage) {
          fileMap.set(key, item);
          logger.info(`🔄 Replaced ${existing.attachment.name} with current message version`);
        } else if (!item.isCurrentMessage && !existing.isCurrentMessage && item.timestamp > existing.timestamp) {
          fileMap.set(key, item);
          logger.info(`🔄 Replaced ${existing.attachment.name} with newer version`);
        }
      }
    }
    
    // Step 3: Process the deduplicated files
    logger.info(`📋 Deduplication result: ${fileMap.size} unique files (${duplicatesSkipped} duplicates removed)`);
    for (const [, { attachment }] of fileMap.entries()) {
      const claudeAttachment = await this.createClaudeAttachment(attachment);
      if (claudeAttachment) {
        claudeContent.push(claudeAttachment);
        logger.info(`✅ Processed: ${attachment.name} → ${claudeAttachment.type} content`);
      } else {
        logger.warn(`❌ Unsupported file type: ${attachment.name}`);
      }
    }
    
    logger.info(`🎯 Context documents ready: ${claudeContent.length} files for Claude`);
    return claudeContent;
  }

  /**
   * Process attachments from current message only (legacy method)
   */
  async processAttachments(message: Message): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }>> {
    const claudeContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }> = [];
    
    // Check current message for attachments
    logger.info(`🔍 Current message has ${message.attachments.size} attachments`);
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        logger.info(`📎 Processing attachment: ${attachment.name} (${attachment.size} bytes, ${attachment.contentType})`);
        const claudeAttachment = await this.createClaudeAttachment(attachment);
        if (claudeAttachment) {
          logger.info(`✅ Successfully processed attachment for Claude`);
          claudeContent.push(claudeAttachment);
        } else {
          logger.info(`❌ Skipped attachment (unsupported or too large)`);
        }
      }
    }

    return claudeContent;
  }

  /**
   * Create Claude-compatible attachment content
   */
  private async createClaudeAttachment(attachment: Attachment): Promise<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown } | null> {
    if (attachment.size > this.maxFileSize) {
      logger.warn(`File ${attachment.name} too large (${attachment.size} bytes) - Claude max is 32MB`);
      return null;
    }

    const fileType = this.getClaudeFileType(attachment.name, attachment.contentType || undefined);
    
    if (!fileType) {
      logger.warn(`Unsupported file type for Claude: ${attachment.contentType || 'unknown'} (${attachment.name})`);
      return null;
    }

    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        logger.warn(`Failed to fetch attachment: ${response.status}`);
        return null;
      }

      if (fileType === 'image') {
        // For images, use Claude's native image processing
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.contentType,
            data: base64
          }
        };
      } else if (fileType === 'document') {
        // For PDFs only - use Claude's native document processing
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        return {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf', // Only PDFs supported for document type
            data: base64
          }
        };
      } else if (fileType === 'text') {
        // For text files - use text content type (Claude API change)
        const text = await response.text();
        
        return {
          type: 'text',
          text: `**${attachment.name}:**\n\n${text}`
        };
      }

      return null;

    } catch (error) {
      logger.error(`Error processing attachment ${attachment.name}:`, error);
      return null;
    }
  }

  /**
   * Determine if file type is supported by Claude natively
   */
  private getClaudeFileType(filename: string, contentType?: string): 'image' | 'document' | 'text' | null {
    const ext = filename.toLowerCase().split('.').pop();
    
    // Images - Claude native support
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '') || contentType?.startsWith('image/')) {
      return 'image';
    }
    
    // Documents - Claude native support (PDFs only)
    if (['pdf'].includes(ext || '') || contentType === 'application/pdf') {
      return 'document';
    }
    
    // Text documents - Use text content type instead of document
    if (['txt', 'md', 'markdown', 'json', 'html', 'rtf'].includes(ext || '') || contentType?.startsWith('text/')) {
      return 'text';
    }
    
    return null;
  }

  /**
   * Check if file type is supported
   */
  isFileTypeSupported(filename: string, contentType?: string): boolean {
    return this.getClaudeFileType(filename, contentType) !== null;
  }

  /**
   * Get maximum file size allowed
   */
  getMaxFileSize(): number {
    return this.maxFileSize;
  }
} 