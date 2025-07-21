import { Attachment } from 'discord.js';
import { logger } from '../../infra/logging';

/**
 * Base File Processor
 * Common functionality for all file format processors
 */
export abstract class BaseProcessor {
  protected readonly maxFileSize: number;
  protected readonly supportedExtensions: string[];

  constructor(maxFileSize: number = 32 * 1024 * 1024, supportedExtensions: string[] = []) {
    this.maxFileSize = maxFileSize;
    this.supportedExtensions = supportedExtensions.map(ext => ext.toLowerCase());
  }

  /**
   * Check if file is supported by this processor
   */
  canProcess(attachment: Attachment): boolean {
    if (attachment.size > this.maxFileSize) {
      logger.warn(`File too large: ${attachment.name} (${attachment.size} bytes > ${this.maxFileSize})`);
      return false;
    }

    const extension = this.getFileExtension(attachment.name);
    return this.supportedExtensions.includes(extension);
  }

  /**
   * Get file extension from filename
   */
  protected getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot === -1 ? '' : filename.substring(lastDot + 1).toLowerCase();
  }

  /**
   * Generate unique identifier for file deduplication
   */
  protected generateFileId(attachment: Attachment): string {
    // Use URL as unique identifier (includes Discord's hash)
    return attachment.url.split('?')[0]; // Remove query parameters
  }

  /**
   * Check if file is a duplicate based on name and size
   */
  protected isDuplicate(attachment: Attachment, existingAttachments: Attachment[]): boolean {
    return existingAttachments.some(existing => 
      existing.name === attachment.name && 
      existing.size === attachment.size &&
      existing.url !== attachment.url // Different upload but same content
    );
  }

  /**
   * Get MIME type from attachment
   */
  protected getMimeType(attachment: Attachment): string {
    return attachment.contentType || this.inferMimeType(attachment.name);
  }

  /**
   * Infer MIME type from file extension
   */
  protected inferMimeType(filename: string): string {
    const extension = this.getFileExtension(filename);
    
    const mimeTypes: Record<string, string> = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'bmp': 'image/bmp',
      'ico': 'image/x-icon',
      
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      
      // Text
      'txt': 'text/plain',
      'md': 'text/markdown',
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'text/javascript',
      'json': 'application/json',
      'xml': 'application/xml',
      'csv': 'text/csv',
      
      // Code
      'py': 'text/x-python',
      'ts': 'text/typescript',
      'tsx': 'text/typescript',
      'jsx': 'text/javascript',
      'java': 'text/x-java-source',
      'cpp': 'text/x-c++src',
      'c': 'text/x-csrc',
      'h': 'text/x-chdr',
      'sql': 'text/x-sql',
      'sh': 'text/x-shellscript',
      'yml': 'text/yaml',
      'yaml': 'text/yaml',
      
      // Archives
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
      
      // Other
      'mp3': 'audio/mpeg',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * Fetch file content as buffer
   */
  protected async fetchFileContent(attachment: Attachment): Promise<Buffer> {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error(`Failed to fetch file content for ${attachment.name}:`, error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch file content as text
   */
  protected async fetchFileText(attachment: Attachment, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const buffer = await this.fetchFileContent(attachment);
    return buffer.toString(encoding);
  }

  /**
   * Get basic file metadata
   */
  protected getFileMetadata(attachment: Attachment) {
    return {
      name: attachment.name,
      size: attachment.size,
      extension: this.getFileExtension(attachment.name),
      mimeType: this.getMimeType(attachment),
      url: attachment.url,
      id: this.generateFileId(attachment)
    };
  }

  /**
   * Format file size for display
   */
  protected formatFileSize(bytes: number): string {
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
   * Create error message for processing failures
   */
  protected createErrorMessage(attachment: Attachment, error: Error): string {
    return `Failed to process ${attachment.name}: ${error.message}`;
  }

  /**
   * Abstract method to process the file
   * Must be implemented by concrete processors
   */
  abstract processFile(attachment: Attachment): Promise<{
    type: 'text' | 'image' | 'document';
    text?: string;
    source?: unknown;
  }>;

  /**
   * Process file with error handling and logging
   */
  async safeProcessFile(attachment: Attachment): Promise<{
    type: 'text' | 'image' | 'document';
    text?: string;
    source?: unknown;
  } | null> {
    try {
      if (!this.canProcess(attachment)) {
        return null;
      }

      logger.info(`Processing ${attachment.name} (${this.formatFileSize(attachment.size)})`);
      const result = await this.processFile(attachment);
      logger.info(`Successfully processed ${attachment.name}`);
      
      return result;
    } catch (error) {
      logger.error(this.createErrorMessage(attachment, error as Error));
      return null;
    }
  }
} 