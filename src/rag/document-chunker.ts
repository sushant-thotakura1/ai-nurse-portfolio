/**
 * Document Chunking Utility
 *
 * This module provides functionality to split documents into smaller chunks
 * for embedding generation. It handles various text types and preserves
 * semantic boundaries to maintain context across chunks.
 */

/**
 * Configuration options for document chunking
 */
export interface ChunkOptions {
  /** Maximum characters per chunk (default: 1000) */
  maxChunkSize: number;
  /** Characters to overlap between chunks (default: 200) */
  overlapSize: number;
  /** Try to split at sentence boundaries (default: true) */
  preserveBoundaries: boolean;
}

/**
 * Represents a single chunk of a document with metadata
 */
export interface DocumentChunk {
  /** Zero-based index of the chunk in the document */
  index: number;
  /** The chunk text content */
  text: string;
  /** Starting character position in the original document */
  startPosition: number;
  /** Ending character position in the original document */
  endPosition: number;
  /** Optional metadata that can be attached to the chunk */
  metadata?: Record<string, any>;
}

/**
 * Default chunking options
 */
const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 1000,
  overlapSize: 200,
  preserveBoundaries: true,
};

/**
 * Sentence boundary markers - characters that typically end a sentence
 */
const SENTENCE_TERMINATORS = ['.', '!', '?', ':', '\n\n'];

/**
 * Normalizes whitespace in text while preserving paragraph breaks
 * - Removes leading/trailing whitespace
 * - Collapses multiple spaces into single space
 * - Preserves double newlines (paragraph breaks)
 *
 * @param text - The text to normalize
 * @returns Normalized text
 */
function normalizeWhitespace(text: string): string {
  return text
    .trim()
    // Preserve paragraph breaks
    .replace(/\n\n+/g, '\n\n')
    // Collapse multiple spaces into one
    .replace(/[^\S\n]+/g, ' ')
    // Clean up space around paragraph breaks
    .replace(/ *\n\n */g, '\n\n');
}

/**
 * Finds the best position to split text, preferring sentence boundaries
 *
 * @param text - The text to analyze
 * @param maxPosition - The maximum position to search up to
 * @returns The position to split at, or maxPosition if no boundary found
 */
function findBestSplitPosition(text: string, maxPosition: number): number {
  // If maxPosition is beyond text length, return text length
  if (maxPosition >= text.length) {
    return text.length;
  }

  // Look backwards from maxPosition to find a sentence terminator
  for (let i = maxPosition; i >= Math.max(0, maxPosition - 200); i--) {
    const char = text[i];

    // Check for paragraph break first (highest priority)
    if (i > 0 && text.substring(i - 1, i + 1) === '\n\n') {
      return i + 1; // Split after the paragraph break
    }

    // Check for sentence terminators
    if (SENTENCE_TERMINATORS.includes(char)) {
      // Make sure there's a space or end of text after the terminator
      if (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\n') {
        return i + 1; // Include the terminator in the current chunk
      }
    }
  }

  // No boundary found, split at maxPosition
  return maxPosition;
}

/**
 * Splits a document into smaller chunks for embedding generation
 *
 * This function intelligently divides large documents into manageable chunks
 * while preserving context through overlapping text and respecting sentence
 * boundaries when possible.
 *
 * Algorithm:
 * 1. Normalize whitespace in the input content
 * 2. Iterate through the content with a sliding window
 * 3. For each chunk, try to split at sentence boundaries if enabled
 * 4. Create overlapping chunks to preserve context
 * 5. Return array of chunks with metadata
 *
 * @param content - The document content to chunk
 * @param options - Optional configuration (merged with defaults)
 * @returns Array of document chunks with metadata
 *
 * @example
 * ```typescript
 * const content = "First sentence. Second sentence. Third sentence.";
 * const chunks = chunkDocument(content, { maxChunkSize: 30, overlapSize: 10 });
 * ```
 */
export function chunkDocument(
  content: string,
  options?: Partial<ChunkOptions>
): DocumentChunk[] {
  // Merge provided options with defaults
  const opts: ChunkOptions = { ...DEFAULT_OPTIONS, ...options };

  // Validate options
  if (opts.maxChunkSize <= 0) {
    throw new Error('maxChunkSize must be greater than 0');
  }
  if (opts.overlapSize < 0) {
    throw new Error('overlapSize must be non-negative');
  }
  if (opts.overlapSize >= opts.maxChunkSize) {
    throw new Error('overlapSize must be less than maxChunkSize');
  }

  // Normalize the content
  const normalizedContent = normalizeWhitespace(content);

  // Handle empty or whitespace-only content
  if (normalizedContent.length === 0) {
    return [];
  }

  // If content fits in one chunk, return it as-is
  if (normalizedContent.length <= opts.maxChunkSize) {
    return [
      {
        index: 0,
        text: normalizedContent,
        startPosition: 0,
        endPosition: normalizedContent.length,
      },
    ];
  }

  const chunks: DocumentChunk[] = [];
  let currentPosition = 0;
  let chunkIndex = 0;

  // Iterate through the content, creating chunks
  while (currentPosition < normalizedContent.length) {
    // Determine the end position for this chunk
    const idealEndPosition = currentPosition + opts.maxChunkSize;

    let actualEndPosition: number;

    if (opts.preserveBoundaries && idealEndPosition < normalizedContent.length) {
      // Try to find a sentence boundary
      actualEndPosition = findBestSplitPosition(
        normalizedContent,
        idealEndPosition
      );
    } else {
      // No boundary preservation or we're at the end
      actualEndPosition = Math.min(idealEndPosition, normalizedContent.length);
    }

    // Extract the chunk text
    const chunkText = normalizedContent.substring(currentPosition, actualEndPosition);

    // Skip empty chunks (shouldn't happen, but safety check)
    if (chunkText.trim().length > 0) {
      chunks.push({
        index: chunkIndex,
        text: chunkText.trim(),
        startPosition: currentPosition,
        endPosition: actualEndPosition,
      });
      chunkIndex++;
    }

    // Move to the next chunk position with overlap
    // For the last chunk, we don't need to continue
    if (actualEndPosition >= normalizedContent.length) {
      break;
    }

    // Calculate next position: move forward but overlap
    currentPosition = actualEndPosition - opts.overlapSize;

    // Ensure we make progress (avoid infinite loop)
    if (currentPosition <= chunks[chunks.length - 1]?.startPosition) {
      currentPosition = actualEndPosition;
    }
  }

  return chunks;
}

/**
 * Utility function to estimate token count from character count
 * Rule of thumb: 1 token ≈ 4 characters for English text
 *
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Validates if a chunk size is appropriate for a given embedding model
 *
 * @param chunkSize - The chunk size in characters
 * @param modelTokenLimit - The model's token limit (default: 8191 for text-embedding-3-small)
 * @returns True if the chunk size is safe, false otherwise
 */
export function validateChunkSize(
  chunkSize: number,
  modelTokenLimit: number = 8191
): boolean {
  const estimatedTokens = estimateTokenCount('a'.repeat(chunkSize));
  return estimatedTokens <= modelTokenLimit;
}
