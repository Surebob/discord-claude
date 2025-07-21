import { Attachment } from 'discord.js';
import { BaseProcessor } from './base-processor';
import { logger } from '../../infra/logging';

/**
 * Image File Processor
 * Handles image files for Claude API integration
 */
export class ImageProcessor extends BaseProcessor {
  private static readonly IMAGE_EXTENSIONS = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'
  ];

  private static readonly CLAUDE_SUPPORTED_FORMATS = [
    'jpg', 'jpeg', 'png', 'gif', 'webp'
  ];

  constructor() {
    super(20 * 1024 * 1024, ImageProcessor.IMAGE_EXTENSIONS); // 20MB max for images
  }

  /**
   * Check if image format is supported by Claude
   */
  private isSupportedByClaude(attachment: Attachment): boolean {
    const extension = this.getFileExtension(attachment.name);
    return ImageProcessor.CLAUDE_SUPPORTED_FORMATS.includes(extension);
  }

  /**
   * Get image dimensions if available from Discord metadata
   */
  private getImageDimensions(attachment: Attachment): { width?: number; height?: number } {
    return {
      width: attachment.width || undefined,
      height: attachment.height || undefined
    };
  }

  /**
   * Process image file for Claude API
   */
  async processFile(attachment: Attachment): Promise<{
    type: 'image';
    source: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }> {
    if (!this.isSupportedByClaude(attachment)) {
      throw new Error(`Image format not supported by Claude: ${this.getFileExtension(attachment.name)}`);
    }

    try {
      const buffer = await this.fetchFileContent(attachment);
      const base64Data = buffer.toString('base64');
      const mimeType = this.getMimeType(attachment);
      const dimensions = this.getImageDimensions(attachment);

      logger.info(`Processed image: ${attachment.name} (${this.formatFileSize(attachment.size)}, ${dimensions.width}x${dimensions.height})`);

      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64Data
        }
      };
    } catch (error) {
      throw new Error(`Failed to process image ${attachment.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a text description of the image for context
   */
  async createImageDescription(attachment: Attachment): Promise<string> {
    const metadata = this.getFileMetadata(attachment);
    const dimensions = this.getImageDimensions(attachment);
    
    let description = `📷 **Image**: ${metadata.name}`;
    
    if (dimensions.width && dimensions.height) {
      description += ` (${dimensions.width}×${dimensions.height})`;
    }
    
    description += ` - ${this.formatFileSize(metadata.size)}`;
    
    if (!this.isSupportedByClaude(attachment)) {
      description += ` ⚠️ *Format not supported by AI analysis*`;
    }

    return description;
  }

  /**
   * Check if image needs resizing for Claude API limits
   */
  needsResizing(attachment: Attachment): boolean {
    const maxDimension = 1568; // Claude's max dimension
    const dimensions = this.getImageDimensions(attachment);
    
    if (!dimensions.width || !dimensions.height) {
      return false; // Can't determine without dimensions
    }

    return dimensions.width > maxDimension || dimensions.height > maxDimension;
  }

  /**
   * Get suggested resize dimensions
   */
  getSuggestedDimensions(attachment: Attachment): { width: number; height: number } | null {
    const dimensions = this.getImageDimensions(attachment);
    
    if (!dimensions.width || !dimensions.height) {
      return null;
    }

    const maxDimension = 1568;
    const aspectRatio = dimensions.width / dimensions.height;

    if (dimensions.width > dimensions.height) {
      // Landscape
      return {
        width: Math.min(maxDimension, dimensions.width),
        height: Math.round(Math.min(maxDimension, dimensions.width) / aspectRatio)
      };
    } else {
      // Portrait or square
      return {
        width: Math.round(Math.min(maxDimension, dimensions.height) * aspectRatio),
        height: Math.min(maxDimension, dimensions.height)
      };
    }
  }

  /**
   * Validate image for Claude processing
   */
  validateForClaude(attachment: Attachment): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check file size (Claude limit is around 20MB)
    if (attachment.size > 20 * 1024 * 1024) {
      issues.push(`File too large: ${this.formatFileSize(attachment.size)} (max 20MB)`);
    }

    // Check format support
    if (!this.isSupportedByClaude(attachment)) {
      issues.push(`Format not supported: ${this.getFileExtension(attachment.name)}`);
    }

    // Check dimensions if available
    if (this.needsResizing(attachment)) {
      const suggested = this.getSuggestedDimensions(attachment);
      if (suggested) {
        issues.push(`Image too large: ${attachment.width}×${attachment.height} (suggest ${suggested.width}×${suggested.height})`);
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Get image analysis prompt for Claude
   */
  getAnalysisPrompt(attachment: Attachment, userQuery?: string): string {
    const filename = attachment.name;
    const fileSize = this.formatFileSize(attachment.size);
    const dimensions = this.getImageDimensions(attachment);
    
    let prompt = `Please analyze this image: "${filename}"`;
    
    if (dimensions.width && dimensions.height) {
      prompt += ` (${dimensions.width}×${dimensions.height}, ${fileSize})`;
    }

    if (userQuery) {
      prompt += `\n\nSpecific question: ${userQuery}`;
    } else {
      prompt += `\n\nPlease describe what you see in detail, including any text, objects, people, colors, composition, and any other relevant information.`;
    }

    return prompt;
  }
} 