import { Message, Attachment } from 'discord.js';
import { logger } from '../infra/logging';
import { BaseProcessor } from './formats/base-processor';
import { ImageProcessor } from './formats/image-processor';
import { TextProcessor } from './formats/text-processor';
import { PDFProcessor } from './formats/pdf-processor';

/**
 * Attachment Manager
 * Coordinates file processing across different formats and handles deduplication
 */
export class AttachmentManager {
  private processors: BaseProcessor[];
  private imageProcessor: ImageProcessor;
  private textProcessor: TextProcessor;
  private pdfProcessor: PDFProcessor;

  constructor() {
    this.imageProcessor = new ImageProcessor();
    this.textProcessor = new TextProcessor();
    this.pdfProcessor = new PDFProcessor();
    
    this.processors = [
      this.imageProcessor,
      this.textProcessor,
      this.pdfProcessor
    ];
  }

  /**
   * Find appropriate processor for attachment
   */
  private findProcessor(attachment: Attachment): BaseProcessor | null {
    return this.processors.find(processor => processor.canProcess(attachment)) || null;
  }

  /**
   * Get file type category
   */
  private getFileType(attachment: Attachment): 'image' | 'text' | 'pdf' | 'unknown' {
    if (this.imageProcessor.canProcess(attachment)) return 'image';
    if (this.textProcessor.canProcess(attachment)) return 'text';
    if (this.pdfProcessor.canProcess(attachment)) return 'pdf';
    return 'unknown';
  }

  /**
   * Process single attachment
   */
  async processSingleAttachment(attachment: Attachment): Promise<{
    type: 'text' | 'image' | 'document';
    text?: string;
    source?: unknown;
  } | null> {
    const processor = this.findProcessor(attachment);
    
    if (!processor) {
      logger.warn(`No processor found for file: ${attachment.name}`);
      return null;
    }

    try {
      return await processor.safeProcessFile(attachment);
    } catch (error) {
      logger.error(`Error processing ${attachment.name}:`, error);
      return null;
    }
  }

  /**
   * Process attachments with smart deduplication
   */
  async processAttachmentsWithDeduplication(
    message: Message,
    messageLimit?: number
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }>> {
    const claudeContent: Array<{ type: 'text'; text: string } | { type: 'image'; source: unknown } | { type: 'document'; source: unknown }> = [];
    
    // Collect all attachments from current + recent messages
    const allAttachments = await this.collectAllAttachments(message, messageLimit);
    
    // Deduplicate by content signature
    const uniqueAttachments = this.deduplicateAttachments(allAttachments);
    
    // Sort by priority (current message first, then by size/type)
    const sortedAttachments = this.sortAttachmentsByPriority(uniqueAttachments);
    
    // Process attachments
    for (const { attachment, isCurrentMessage } of sortedAttachments) {
      const result = await this.processSingleAttachment(attachment);
      
      if (result) {
        claudeContent.push(result as any);
        logger.info(`✅ Processed: ${attachment.name} (${isCurrentMessage ? 'current' : 'history'})`);
      } else {
        // Add fallback description for unsupported files
        const description = await this.createFileDescription(attachment);
        claudeContent.push({
          type: 'text',
          text: description
        });
      }
    }

    logger.info(`📁 Processed ${claudeContent.length} files total`);
    return claudeContent;
  }

  /**
   * Collect attachments from current and recent messages
   */
  private async collectAllAttachments(
    message: Message,
    messageLimit?: number
  ): Promise<Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }>> {
    const allAttachments: Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }> = [];
    
    // Add current message attachments (highest priority)
    if (message.attachments.size > 0) {
      for (const attachment of message.attachments.values()) {
        allAttachments.push({
          attachment,
          messageId: message.id,
          timestamp: message.createdTimestamp,
          isCurrentMessage: true
        });
      }
    }

    // Add recent message history attachments
    try {
      const limit = messageLimit || 21;
      const recentMessages = await message.channel.messages.fetch({ limit });
      
      for (const [, msg] of recentMessages) {
        if (msg.id !== message.id && msg.attachments.size > 0) {
          for (const attachment of msg.attachments.values()) {
            allAttachments.push({
              attachment,
              messageId: msg.id,
              timestamp: msg.createdTimestamp,
              isCurrentMessage: false
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching message history for attachments:', error);
    }

    return allAttachments;
  }

  /**
   * Deduplicate attachments based on name, size, and URL signature
   */
  private deduplicateAttachments(
    attachments: Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }>
  ): Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }> {
    const seen = new Set<string>();
    const unique: Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }> = [];

    for (const item of attachments) {
      const signature = this.generateAttachmentSignature(item.attachment);
      
      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(item);
      } else {
        logger.debug(`🔄 Skipping duplicate: ${item.attachment.name}`);
      }
    }

    return unique;
  }

  /**
   * Generate unique signature for attachment
   */
  private generateAttachmentSignature(attachment: Attachment): string {
    // Use filename + size + content hash from URL
    const urlHash = attachment.url.split('/').pop()?.split('?')[0] || '';
    return `${attachment.name}-${attachment.size}-${urlHash}`;
  }

  /**
   * Sort attachments by processing priority
   */
  private sortAttachmentsByPriority(
    attachments: Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }>
  ): Array<{ attachment: Attachment; messageId: string; timestamp: number; isCurrentMessage: boolean }> {
    return attachments.sort((a, b) => {
      // Current message attachments first
      if (a.isCurrentMessage && !b.isCurrentMessage) return -1;
      if (!a.isCurrentMessage && b.isCurrentMessage) return 1;
      
      // Then by file type priority (images > PDFs > text)
      const typeA = this.getFileType(a.attachment);
      const typeB = this.getFileType(b.attachment);
      
      const typePriority = { image: 0, pdf: 1, text: 2, unknown: 3 };
      const priorityDiff = typePriority[typeA] - typePriority[typeB];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by timestamp (newer first)
      return b.timestamp - a.timestamp;
    });
  }

  /**
   * Create description for unsupported files
   */
  private async createFileDescription(attachment: Attachment): Promise<string> {
    const fileType = this.getFileType(attachment);
    const size = this.formatFileSize(attachment.size);
    
    switch (fileType) {
      case 'image':
        return this.imageProcessor.createImageDescription(attachment);
      case 'text':
        return this.textProcessor.createTextSummary(attachment);
      case 'pdf':
        return this.pdfProcessor.createPDFDescription(attachment);
      default:
        return `📎 **${attachment.name}** - Unsupported file type (${size})`;
    }
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Get statistics about processed attachments
   */
  getProcessingStats(
    results: Array<{ type: 'text' | 'image' | 'document'; text?: string; source?: unknown }>
  ): {
    total: number;
    byType: Record<string, number>;
    totalSize: number;
  } {
    const stats = {
      total: results.length,
      byType: { text: 0, image: 0, document: 0 },
      totalSize: 0
    };

    results.forEach(result => {
      stats.byType[result.type]++;
    });

    return stats;
  }

  /**
   * Validate all attachments before processing
   */
  validateAttachments(attachments: Attachment[]): {
    valid: Attachment[];
    invalid: Array<{ attachment: Attachment; issues: string[] }>;
  } {
    const valid: Attachment[] = [];
    const invalid: Array<{ attachment: Attachment; issues: string[] }> = [];

    for (const attachment of attachments) {
      const processor = this.findProcessor(attachment);
      
      if (processor) {
        const validation = processor.canProcess(attachment);
        if (validation) {
          valid.push(attachment);
        } else {
          invalid.push({
            attachment,
            issues: [`File type not supported: ${attachment.name}`]
          });
        }
      } else {
        invalid.push({
          attachment,
          issues: [`No processor available for: ${attachment.name}`]
        });
      }
    }

    return { valid, invalid };
  }
} 