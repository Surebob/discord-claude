/**
 * Message Splitter
 * Utility for splitting long messages intelligently for Discord's character limits
 */
export class MessageSplitter {
  /**
   * Split message intelligently by paragraphs, sentences, then words
   */
  splitMessage(text: string, maxLength: number = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let chunk = remaining.substring(0, maxLength);
      
      // Try to break at paragraph
      let breakIndex = chunk.lastIndexOf('\n\n');
      if (breakIndex === -1) {
        // Try to break at sentence
        breakIndex = chunk.lastIndexOf('. ');
        if (breakIndex !== -1) breakIndex += 2;
      }
      if (breakIndex === -1) {
        // Try to break at word
        breakIndex = chunk.lastIndexOf(' ');
      }
      if (breakIndex === -1) {
        // Force break
        breakIndex = maxLength;
      }

      chunk = remaining.substring(0, breakIndex);
      chunks.push(chunk);
      remaining = remaining.substring(breakIndex).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Split message for code blocks (preserves formatting)
   */
  splitCodeMessage(text: string, maxLength: number = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;
    const codeBlockRegex = /```[\s\S]*?```/g;

    while (remaining.length > maxLength) {
      let chunk = remaining.substring(0, maxLength);
      
      // Check if we're in the middle of a code block
      const codeBlocks = [...remaining.matchAll(codeBlockRegex)];
      const currentPos = chunk.length;
      
      for (const block of codeBlocks) {
        if (block.index !== undefined && block.index < currentPos && block.index + block[0].length > currentPos) {
          // We're in the middle of a code block, break before it
          chunk = remaining.substring(0, block.index);
          break;
        }
      }
      
      // If no code block issues, use normal splitting
      if (chunk.length === maxLength) {
        chunk = this.splitMessage(chunk, maxLength)[0];
      }

      chunks.push(chunk);
      remaining = remaining.substring(chunk.length).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Estimate if a message needs splitting
   */
  needsSplitting(text: string, maxLength: number = 2000): boolean {
    return text.length > maxLength;
  }

  /**
   * Get chunk count for a text
   */
  getChunkCount(text: string, maxLength: number = 2000): number {
    return this.splitMessage(text, maxLength).length;
  }
} 