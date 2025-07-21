/**
 * File Processing Module
 * 
 * Comprehensive file processing system with format-specific handlers:
 * - Smart deduplication across message history
 * - Claude API format conversion
 * - Support for images, PDFs, text files, and code
 * - Attachment management and coordination
 * 
 * @example
 * ```typescript
 * import { FileProcessor, AttachmentManager, ImageProcessor } from '@/modules/files';
 * 
 * const processor = new FileProcessor();
 * const result = await processor.processAttachmentsWithDeduplication(message);
 * 
 * // Or use specific processors
 * const imageProcessor = new ImageProcessor();
 * const imageResult = await imageProcessor.processFile(attachment);
 * ```
 */

// Export main processors
export { FileProcessor } from './processor';
export { AttachmentManager } from './attachment-manager';

// Export format-specific processors
export { BaseProcessor } from './formats/base-processor';
export { ImageProcessor } from './formats/image-processor';
export { TextProcessor } from './formats/text-processor';
export { PDFProcessor } from './formats/pdf-processor'; 