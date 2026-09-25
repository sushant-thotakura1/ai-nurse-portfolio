import {
  chunkDocument,
  estimateTokenCount,
  validateChunkSize,
  ChunkOptions,
  DocumentChunk,
} from '../document-chunker';

describe('Document Chunker', () => {
  describe('chunkDocument - basic functionality', () => {
    it('should return empty array for empty string', () => {
      const chunks = chunkDocument('');
      expect(chunks).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      const chunks = chunkDocument('   \n  \t  ');
      expect(chunks).toEqual([]);
    });

    it('should return single chunk for content shorter than maxChunkSize', () => {
      const content = 'This is a short document.';
      const chunks = chunkDocument(content, { maxChunkSize: 1000 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toMatchObject({
        index: 0,
        text: content,
        startPosition: 0,
        endPosition: content.length,
      });
    });

    it('should split long content into multiple chunks', () => {
      const content = 'A'.repeat(2500);
      const chunks = chunkDocument(content, { maxChunkSize: 1000, overlapSize: 200 });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.text.length).toBeLessThanOrEqual(1000);
      });
    });
  });

  describe('chunkDocument - custom options', () => {
    it('should respect custom maxChunkSize', () => {
      const content = 'A'.repeat(500);
      const chunks = chunkDocument(content, { maxChunkSize: 100, overlapSize: 20 });

      chunks.forEach((chunk) => {
        expect(chunk.text.length).toBeLessThanOrEqual(100);
      });
    });

    it('should respect custom overlapSize', () => {
      const sentences = [
        'First sentence here.',
        'Second sentence here.',
        'Third sentence here.',
        'Fourth sentence here.',
        'Fifth sentence here.',
      ];
      const content = sentences.join(' ');

      const chunks = chunkDocument(content, {
        maxChunkSize: 50,
        overlapSize: 15,
        preserveBoundaries: true,
      });

      // Check that chunks have overlap
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentChunk = chunks[i];
        const nextChunk = chunks[i + 1];

        // The next chunk should start before the current chunk ends
        expect(nextChunk.startPosition).toBeLessThan(currentChunk.endPosition);

        // The overlap should be approximately the specified size
        const overlapStart = nextChunk.startPosition;
        const overlapEnd = currentChunk.endPosition;
        const overlap = overlapEnd - overlapStart;

        // Overlap might be less than requested if we split at sentence boundary
        expect(overlap).toBeGreaterThan(0);
      }
    });

    it('should work with preserveBoundaries disabled', () => {
      const content = 'A'.repeat(2000);
      const chunks = chunkDocument(content, {
        maxChunkSize: 500,
        overlapSize: 100,
        preserveBoundaries: false,
      });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, index) => {
        if (index < chunks.length - 1) {
          // All chunks except the last should be close to maxChunkSize
          expect(chunk.text.length).toBeLessThanOrEqual(500);
        }
      });
    });
  });

  describe('chunkDocument - sentence boundary preservation', () => {
    it('should split at sentence boundaries when possible', () => {
      const content =
        'This is the first sentence. This is the second sentence. This is the third sentence. ' +
        'This is the fourth sentence. This is the fifth sentence. This is the sixth sentence.';

      const chunks = chunkDocument(content, {
        maxChunkSize: 100,
        overlapSize: 20,
        preserveBoundaries: true,
      });

      // Each chunk should end with proper sentence terminator (accounting for trimming)
      chunks.forEach((chunk) => {
        const trimmed = chunk.text.trim();
        // Should end with a complete thought (sentence terminator or be the last chunk)
        if (chunk.index < chunks.length - 1) {
          const lastChar = trimmed[trimmed.length - 1];
          // Allow for various sentence endings
          expect(['.', '!', '?', ':']).toContain(lastChar);
        }
      });
    });

    it('should handle paragraph breaks correctly', () => {
      const content =
        'First paragraph sentence one. First paragraph sentence two.\n\n' +
        'Second paragraph sentence one. Second paragraph sentence two.\n\n' +
        'Third paragraph sentence one. Third paragraph sentence two.';

      const chunks = chunkDocument(content, {
        maxChunkSize: 80,
        overlapSize: 20,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(1);

      // Verify chunks are created
      chunks.forEach((chunk) => {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      });
    });

    it('should handle content with no punctuation gracefully', () => {
      const content = 'A'.repeat(2000);
      const chunks = chunkDocument(content, {
        maxChunkSize: 500,
        overlapSize: 100,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.text.length).toBeGreaterThan(0);
        expect(chunk.text.length).toBeLessThanOrEqual(500);
      });
    });

    it('should handle single very long sentence', () => {
      const content = 'A'.repeat(1500) + '.';
      const chunks = chunkDocument(content, {
        maxChunkSize: 500,
        overlapSize: 100,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // Last chunk should end with the period
      expect(chunks[chunks.length - 1].text.trim().endsWith('.')).toBe(true);
    });
  });

  describe('chunkDocument - markdown content', () => {
    it('should handle markdown headers', () => {
      const content = `# Main Title

This is the introduction paragraph with some content.

## Section One

This is section one content. It has multiple sentences. Each sentence adds information.

## Section Two

This is section two content. It also has multiple sentences.`;

      const chunks = chunkDocument(content, {
        maxChunkSize: 100,
        overlapSize: 20,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      });
    });

    it('should handle markdown lists', () => {
      const content = `Here is a list:

- First item in the list
- Second item in the list
- Third item in the list
- Fourth item in the list
- Fifth item in the list`;

      const chunks = chunkDocument(content, {
        maxChunkSize: 80,
        overlapSize: 15,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      });
    });

    it('should handle code blocks', () => {
      const content = `Here is some code:

\`\`\`javascript
function example() {
  return "Hello, World!";
}
\`\`\`

And here is more text after the code block.`;

      const chunks = chunkDocument(content, { maxChunkSize: 100, overlapSize: 20 });

      expect(chunks.length).toBeGreaterThan(0);
      chunks.forEach((chunk) => {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('chunkDocument - overlap correctness', () => {
    it('should create overlapping chunks', () => {
      const content = 'The quick brown fox. Jumps over lazy dog. Makes a good test. For chunking overlap.';

      const chunks = chunkDocument(content, {
        maxChunkSize: 40,
        overlapSize: 15,
        preserveBoundaries: true,
      });

      if (chunks.length > 1) {
        for (let i = 0; i < chunks.length - 1; i++) {
          const currentEnd = chunks[i].endPosition;
          const nextStart = chunks[i + 1].startPosition;

          // Next chunk should start before current ends (overlap)
          expect(nextStart).toBeLessThan(currentEnd);
        }
      }
    });

    it('should maintain context in overlapping regions', () => {
      const content = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';

      const chunks = chunkDocument(content, {
        maxChunkSize: 35,
        overlapSize: 15,
        preserveBoundaries: true,
      });

      // Verify each chunk has content and overlaps properly
      for (let i = 0; i < chunks.length - 1; i++) {
        expect(chunks[i].text.trim().length).toBeGreaterThan(0);
        expect(chunks[i + 1].startPosition).toBeLessThanOrEqual(chunks[i].endPosition);
      }
    });
  });

  describe('chunkDocument - metadata and indices', () => {
    it('should assign correct chunk indices', () => {
      const content = 'A'.repeat(3000);
      const chunks = chunkDocument(content, { maxChunkSize: 500, overlapSize: 100 });

      chunks.forEach((chunk, index) => {
        expect(chunk.index).toBe(index);
      });
    });

    it('should track positions correctly', () => {
      const content = 'First. Second. Third. Fourth. Fifth. Sixth.';
      const chunks = chunkDocument(content, {
        maxChunkSize: 20,
        overlapSize: 5,
        preserveBoundaries: true,
      });

      chunks.forEach((chunk) => {
        expect(chunk.startPosition).toBeGreaterThanOrEqual(0);
        expect(chunk.endPosition).toBeGreaterThan(chunk.startPosition);
        expect(chunk.endPosition).toBeLessThanOrEqual(content.length);
      });
    });

    it('should maintain sequential positions', () => {
      const content = 'A'.repeat(2000);
      const chunks = chunkDocument(content, { maxChunkSize: 400, overlapSize: 80 });

      for (let i = 0; i < chunks.length - 1; i++) {
        // Next chunk should start before or at current chunk end
        expect(chunks[i + 1].startPosition).toBeLessThanOrEqual(chunks[i].endPosition);
      }

      // Last chunk should end at content length
      expect(chunks[chunks.length - 1].endPosition).toBe(content.length);
    });
  });

  describe('chunkDocument - edge cases', () => {
    it('should handle single word', () => {
      const content = 'Word';
      const chunks = chunkDocument(content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Word');
    });

    it('should handle single sentence exactly at chunk size', () => {
      const content = 'A'.repeat(1000);
      const chunks = chunkDocument(content, { maxChunkSize: 1000, overlapSize: 100 });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text.length).toBe(1000);
    });

    it('should handle excessive whitespace', () => {
      const content = 'Word1.    \n\n\n   Word2.     \t\t   Word3.';
      const chunks = chunkDocument(content);

      expect(chunks).toHaveLength(1);
      // Should normalize to reasonable whitespace
      expect(chunks[0].text).not.toContain('   ');
      expect(chunks[0].text).toContain('Word1.');
      expect(chunks[0].text).toContain('Word2.');
      expect(chunks[0].text).toContain('Word3.');
    });

    it('should handle Unicode characters', () => {
      const content = '你好世界. こんにちは世界. مرحبا بالعالم. Hello world.';
      const chunks = chunkDocument(content, { maxChunkSize: 30, overlapSize: 10 });

      expect(chunks.length).toBeGreaterThan(0);
      const fullText = chunks.map((c) => c.text).join('');
      // Should contain all Unicode characters
      expect(fullText).toContain('你好');
      expect(fullText).toContain('こんにちは');
      expect(fullText).toContain('مرحبا');
    });

    it('should throw error for invalid maxChunkSize', () => {
      expect(() => chunkDocument('test', { maxChunkSize: 0 })).toThrow(
        'maxChunkSize must be greater than 0'
      );
      expect(() => chunkDocument('test', { maxChunkSize: -100 })).toThrow(
        'maxChunkSize must be greater than 0'
      );
    });

    it('should throw error for negative overlapSize', () => {
      expect(() => chunkDocument('test', { overlapSize: -10 })).toThrow(
        'overlapSize must be non-negative'
      );
    });

    it('should throw error when overlapSize >= maxChunkSize', () => {
      expect(() =>
        chunkDocument('test', { maxChunkSize: 100, overlapSize: 100 })
      ).toThrow('overlapSize must be less than maxChunkSize');

      expect(() =>
        chunkDocument('test', { maxChunkSize: 100, overlapSize: 150 })
      ).toThrow('overlapSize must be less than maxChunkSize');
    });
  });

  describe('chunkDocument - real-world scenarios', () => {
    it('should handle typical medical document', () => {
      const content = `Patient History

The patient is a 45-year-old male presenting with chest pain. He reports the pain started approximately 2 hours ago while at rest. The pain is described as pressure-like and radiates to the left arm.

Medical History

The patient has a history of hypertension and hyperlipidemia. He is currently taking lisinopril 10mg daily and atorvastatin 20mg daily. He denies any history of diabetes or smoking.

Physical Examination

Vital signs: BP 145/90, HR 88, RR 16, Temp 98.6F. Patient appears anxious but in no acute distress. Heart sounds are regular without murmurs. Lungs are clear bilaterally.

Assessment and Plan

Given the patient's presentation and risk factors, we are concerned about acute coronary syndrome. We will obtain ECG, cardiac enzymes, and chest X-ray. The patient will be admitted for observation and further workup.`;

      const chunks = chunkDocument(content, {
        maxChunkSize: 300,
        overlapSize: 50,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(1);

      // Verify all chunks are reasonable
      chunks.forEach((chunk) => {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
        expect(chunk.text.length).toBeLessThanOrEqual(300);
      });

      // Verify we can reconstruct the general content
      const allText = chunks.map((c) => c.text).join(' ');
      expect(allText).toContain('Patient History');
      expect(allText).toContain('chest pain');
      expect(allText).toContain('Physical Examination');
    });

    it('should handle conversation transcript', () => {
      const content = `Nurse: Good morning, how are you feeling today?

Patient: I'm not feeling well. I have a terrible headache and feel nauseous.

Nurse: I see. When did these symptoms start?

Patient: They started last night around 8 PM. I took some ibuprofen but it didn't help much.

Nurse: Have you experienced any vision changes or sensitivity to light?

Patient: Yes, actually. Bright lights make my headache worse.

Nurse: Thank you for letting me know. Let me take your vital signs and we'll have the doctor evaluate you.`;

      const chunks = chunkDocument(content, {
        maxChunkSize: 200,
        overlapSize: 40,
        preserveBoundaries: true,
      });

      expect(chunks.length).toBeGreaterThan(0);

      chunks.forEach((chunk) => {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('estimateTokenCount', () => {
    it('should estimate tokens correctly', () => {
      const text = 'A'.repeat(400); // 400 characters
      const tokens = estimateTokenCount(text);

      expect(tokens).toBe(100); // 400 / 4 = 100 tokens
    });

    it('should round up for partial tokens', () => {
      const text = 'A'.repeat(401); // 401 characters
      const tokens = estimateTokenCount(text);

      expect(tokens).toBe(101); // ceil(401 / 4) = 101 tokens
    });

    it('should handle empty string', () => {
      const tokens = estimateTokenCount('');
      expect(tokens).toBe(0);
    });
  });

  describe('validateChunkSize', () => {
    it('should validate safe chunk sizes', () => {
      expect(validateChunkSize(1000)).toBe(true); // ~250 tokens
      expect(validateChunkSize(4000)).toBe(true); // ~1000 tokens
      expect(validateChunkSize(8000)).toBe(true); // ~2000 tokens
    });

    it('should reject oversized chunks', () => {
      expect(validateChunkSize(50000)).toBe(false); // ~12500 tokens > 8191
      expect(validateChunkSize(100000)).toBe(false); // ~25000 tokens > 8191
    });

    it('should work with custom model token limit', () => {
      expect(validateChunkSize(2000, 500)).toBe(true); // ~500 tokens = 500 limit
      expect(validateChunkSize(2001, 500)).toBe(false); // ~501 tokens > 500 limit
    });
  });
});
