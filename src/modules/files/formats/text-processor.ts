import { Attachment } from 'discord.js';
import { BaseProcessor } from './base-processor';
import { logger } from '../../infra/logging';

/**
 * Text File Processor
 * Handles text files, code files, and other text-based documents
 */
export class TextProcessor extends BaseProcessor {
  private static readonly TEXT_EXTENSIONS = [
    // Plain text
    'txt', 'md', 'csv', 'log', 'rtf', 'readme',
    
    // Code files
    'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'cpp', 'c', 'h', 'hpp',
    'cs', 'php', 'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'r',
    'sql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
    
    // Web technologies
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
    
    // Configuration and data
    'json', 'yaml', 'yml', 'xml', 'toml', 'ini', 'cfg', 'conf',
    'env', 'gitignore', 'gitattributes', 'dockerfile',
    
    // Documentation
    'tex', 'bib', 'org', 'rst', 'adoc', 'wiki'
  ];

  private static readonly BINARY_MARKERS = [
    '\x00', '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07',
    '\x08', '\x0E', '\x0F', '\x10', '\x11', '\x12', '\x13', '\x14',
    '\x15', '\x16', '\x17', '\x18', '\x19', '\x1A', '\x1B', '\x1C',
    '\x1D', '\x1E', '\x1F'
  ];

  constructor() {
    super(16 * 1024 * 1024, TextProcessor.TEXT_EXTENSIONS); // 16MB max for text files
  }

  /**
   * Detect if content is binary by checking for null bytes and control characters
   */
  private isBinaryContent(buffer: Buffer, sampleSize: number = 1024): boolean {
    const sample = buffer.subarray(0, Math.min(sampleSize, buffer.length));
    const text = sample.toString('utf-8');
    
    // Check for binary markers
    for (const marker of TextProcessor.BINARY_MARKERS) {
      if (text.includes(marker)) {
        return true;
      }
    }
    
    // Check for high ratio of non-printable characters
    const printableChars = text.replace(/[\x09\x0A\x0D\x20-\x7E]/g, '').length;
    const ratio = printableChars / text.length;
    
    return ratio > 0.3; // More than 30% non-printable characters suggests binary
  }

  /**
   * Detect text encoding
   */
  private detectEncoding(buffer: Buffer): BufferEncoding {
    // Check for BOM markers
    if (buffer.length >= 3) {
      const bom = buffer.subarray(0, 3);
      if (bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xBF) {
        return 'utf8'; // UTF-8 BOM
      }
    }
    
    if (buffer.length >= 2) {
      const bom = buffer.subarray(0, 2);
      if (bom[0] === 0xFF && bom[1] === 0xFE) {
        return 'utf16le'; // UTF-16 LE BOM
      }
      if (bom[0] === 0xFE && bom[1] === 0xFF) {
        return 'utf16le'; // UTF-16 BE BOM (use LE as closest supported)
      }
    }

    // Default to UTF-8
    return 'utf8';
  }

  /**
   * Get programming language from file extension
   */
  private getLanguage(filename: string): string {
    const extension = this.getFileExtension(filename);
    
    const languageMap: Record<string, string> = {
      'js': 'JavaScript',
      'ts': 'TypeScript',
      'tsx': 'TypeScript React',
      'jsx': 'JavaScript React',
      'py': 'Python',
      'java': 'Java',
      'cpp': 'C++',
      'c': 'C',
      'h': 'C/C++ Header',
      'hpp': 'C++ Header',
      'cs': 'C#',
      'php': 'PHP',
      'rb': 'Ruby',
      'go': 'Go',
      'rs': 'Rust',
      'swift': 'Swift',
      'kt': 'Kotlin',
      'scala': 'Scala',
      'r': 'R',
      'sql': 'SQL',
      'sh': 'Shell Script',
      'bash': 'Bash',
      'zsh': 'Zsh',
      'fish': 'Fish',
      'ps1': 'PowerShell',
      'bat': 'Batch',
      'cmd': 'Command',
      'html': 'HTML',
      'htm': 'HTML',
      'css': 'CSS',
      'scss': 'SCSS',
      'sass': 'Sass',
      'less': 'Less',
      'vue': 'Vue',
      'svelte': 'Svelte',
      'json': 'JSON',
      'yaml': 'YAML',
      'yml': 'YAML',
      'xml': 'XML',
      'toml': 'TOML',
      'ini': 'INI',
      'cfg': 'Configuration',
      'conf': 'Configuration',
      'env': 'Environment',
      'dockerfile': 'Dockerfile',
      'md': 'Markdown',
      'tex': 'LaTeX',
      'org': 'Org-mode',
      'rst': 'reStructuredText',
      'adoc': 'AsciiDoc'
    };

    return languageMap[extension] || 'Text';
  }

  /**
   * Truncate text to fit within limits
   */
  private truncateText(text: string, maxLength: number = 50000): { content: string; truncated: boolean } {
    if (text.length <= maxLength) {
      return { content: text, truncated: false };
    }

    const truncated = text.substring(0, maxLength - 100);
    const lastNewline = truncated.lastIndexOf('\n');
    
    // Try to cut at a natural break point
    const cutPoint = lastNewline > maxLength * 0.8 ? lastNewline : truncated.length;
    
    return {
      content: text.substring(0, cutPoint) + '\n\n[... Content truncated ...]',
      truncated: true
    };
  }

  /**
   * Extract metadata from text content
   */
  private extractMetadata(text: string, filename: string): {
    lineCount: number;
    wordCount: number;
    charCount: number;
    language: string;
    hasCode: boolean;
  } {
    const lines = text.split('\n');
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    const language = this.getLanguage(filename);
    
    // Simple heuristic to detect code-like content
    const codeIndicators = [
      /[{}();]/g, // Common code punctuation
      /\b(function|class|def|import|export|const|let|var|if|else|for|while)\b/g,
      /^\s*[#\/\*].*$/m, // Comments
      /^\s*<[^>]+>/m // HTML tags
    ];
    
    const hasCode = codeIndicators.some(pattern => pattern.test(text));

    return {
      lineCount: lines.length,
      wordCount: words.length,
      charCount: text.length,
      language,
      hasCode
    };
  }

  /**
   * Process text file
   */
  async processFile(attachment: Attachment): Promise<{
    type: 'text';
    text: string;
  }> {
    try {
      const buffer = await this.fetchFileContent(attachment);
      
      // Check if content is binary
      if (this.isBinaryContent(buffer)) {
        throw new Error('File appears to be binary, not text');
      }

      // Detect encoding and convert to text
      const encoding = this.detectEncoding(buffer);
      let text = buffer.toString(encoding);

      // Remove BOM if present
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.substring(1);
      }

      // Get file metadata
      const metadata = this.extractMetadata(text, attachment.name);
      
      // Truncate if too long
      const { content, truncated } = this.truncateText(text);

      // Create formatted content for Claude
      const formattedContent = this.formatTextContent(content, attachment.name, metadata, truncated);

      logger.info(`Processed text file: ${attachment.name} (${metadata.lineCount} lines, ${metadata.wordCount} words, ${metadata.language})`);

      return {
        type: 'text',
        text: formattedContent
      };
    } catch (error) {
      throw new Error(`Failed to process text file ${attachment.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Format text content for Claude with metadata
   */
  private formatTextContent(
    content: string, 
    filename: string, 
    metadata: any, 
    truncated: boolean
  ): string {
    const header = `📄 **File**: ${filename}`;
    const details = `**Language**: ${metadata.language} | **Lines**: ${metadata.lineCount} | **Words**: ${metadata.wordCount} | **Size**: ${this.formatFileSize(content.length)}`;
    
    let formatted = `${header}\n${details}\n`;
    
    if (truncated) {
      formatted += `⚠️ *Large file truncated for analysis*\n`;
    }
    
    formatted += `\n\`\`\`${this.getCodeBlockLanguage(metadata.language)}\n${content}\n\`\`\``;
    
    return formatted;
  }

  /**
   * Get appropriate code block language identifier
   */
  private getCodeBlockLanguage(language: string): string {
    const languageMap: Record<string, string> = {
      'JavaScript': 'javascript',
      'TypeScript': 'typescript',
      'TypeScript React': 'tsx',
      'JavaScript React': 'jsx',
      'Python': 'python',
      'Java': 'java',
      'C++': 'cpp',
      'C': 'c',
      'C#': 'csharp',
      'PHP': 'php',
      'Ruby': 'ruby',
      'Go': 'go',
      'Rust': 'rust',
      'Swift': 'swift',
      'Kotlin': 'kotlin',
      'Scala': 'scala',
      'R': 'r',
      'SQL': 'sql',
      'Shell Script': 'bash',
      'Bash': 'bash',
      'PowerShell': 'powershell',
      'HTML': 'html',
      'CSS': 'css',
      'SCSS': 'scss',
      'JSON': 'json',
      'YAML': 'yaml',
      'XML': 'xml',
      'Markdown': 'markdown',
      'Dockerfile': 'dockerfile'
    };

    return languageMap[language] || 'text';
  }

  /**
   * Create a summary of the text file
   */
  async createTextSummary(attachment: Attachment): Promise<string> {
    try {
      const buffer = await this.fetchFileContent(attachment);
      
      if (this.isBinaryContent(buffer)) {
        return `📄 **${attachment.name}** - Binary file (${this.formatFileSize(attachment.size)})`;
      }

      const encoding = this.detectEncoding(buffer);
      let text = buffer.toString(encoding);
      
      if (text.charCodeAt(0) === 0xFEFF) {
        text = text.substring(1);
      }

      const metadata = this.extractMetadata(text, attachment.name);
      
      return `📄 **${attachment.name}** - ${metadata.language} (${metadata.lineCount} lines, ${this.formatFileSize(attachment.size)})`;
    } catch (error) {
      return `📄 **${attachment.name}** - Error reading file (${this.formatFileSize(attachment.size)})`;
    }
  }

  /**
   * Validate text file for processing
   */
  validateTextFile(attachment: Attachment): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check file size
    if (attachment.size > this.maxFileSize) {
      issues.push(`File too large: ${this.formatFileSize(attachment.size)} (max ${this.formatFileSize(this.maxFileSize)})`);
    }

    // Check if extension is supported
    if (!this.canProcess(attachment)) {
      issues.push(`File type not supported: ${this.getFileExtension(attachment.name)}`);
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }
} 