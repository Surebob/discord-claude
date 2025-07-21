import { Attachment } from 'discord.js';
import { BaseProcessor } from './base-processor';
import { logger } from '../../infra/logging';

/**
 * PDF File Processor
 * Handles PDF documents for Claude API integration
 */
export class PDFProcessor extends BaseProcessor {
  private static readonly PDF_EXTENSIONS = ['pdf'];

  constructor() {
    super(32 * 1024 * 1024, PDFProcessor.PDF_EXTENSIONS); // 32MB max for PDFs
  }

  /**
   * Process PDF file for Claude API
   */
  async processFile(attachment: Attachment): Promise<{
    type: 'document';
    source: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }> {
    try {
      const buffer = await this.fetchFileContent(attachment);
      const base64Data = buffer.toString('base64');

      logger.info(`Processed PDF: ${attachment.name} (${this.formatFileSize(attachment.size)})`);

      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64Data
        }
      };
    } catch (error) {
      throw new Error(`Failed to process PDF ${attachment.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a description of the PDF
   */
  async createPDFDescription(attachment: Attachment): Promise<string> {
    const metadata = this.getFileMetadata(attachment);
    return `📋 **PDF Document**: ${metadata.name} - ${this.formatFileSize(metadata.size)}`;
  }

  /**
   * Validate PDF for Claude processing
   */
  validateForClaude(attachment: Attachment): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check file size (Claude limit)
    if (attachment.size > this.maxFileSize) {
      issues.push(`File too large: ${this.formatFileSize(attachment.size)} (max ${this.formatFileSize(this.maxFileSize)})`);
    }

    // Check format
    if (this.getFileExtension(attachment.name) !== 'pdf') {
      issues.push(`Not a PDF file: ${attachment.name}`);
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
} 