import { trace, SpanStatusCode } from '@opentelemetry/api';
import { ConversationSkill, SessionContext, ContextFragment } from '../conversation-skill';
import { RAGService, QueryResult, RagTracer } from '../../rag/rag-service';
import { LLMProvider } from '../../ai-agent/interfaces';
import { languageDirective } from '../../core/locale-language';
import { logger } from '../../core/logger';

const SIMILARITY_THRESHOLD = 0.3;
const TOP_K = 3;

function buildRagTracer(): RagTracer {
  const tracer = trace.getTracer('ai-nurse-conversation');
  return {
    recordFilter(attrs) {
      const span = tracer.startSpan('ai_nurse.rag.filter');
      Object.entries(attrs).forEach(([k, v]) => span.setAttribute(k, v));
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
    recordSearch(attrs) {
      const span = tracer.startSpan('ai_nurse.rag.search');
      Object.entries(attrs).forEach(([k, v]) => span.setAttribute(k, v));
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },
  };
}

export class QASkill implements ConversationSkill {
  readonly name = 'qa';
  readonly description = 'Patient is asking a medical or health-related question that may benefit from document lookup';

  constructor(
    private readonly ragService: RAGService,
    private readonly llm: LLMProvider,
  ) {}

  async execute(context: SessionContext, _prisma: any): Promise<ContextFragment> {
    // The knowledge base is English and the embedding model is not reliably
    // cross-lingual, so a Hausa/Swahili question scores far below threshold
    // against English chunks. Translate the question to English for retrieval
    // (this also repairs noisy speech-to-text transcripts). The answer is still
    // synthesised back in the patient's language downstream.
    const searchMessage = await this.toEnglishQuery(context.currentMessage, context.locale);

    const enrichedQuery = context.condition
      ? `${context.condition} patient: ${searchMessage}`
      : searchMessage;

    let results: QueryResult[];
    try {
      results = await this.ragService.queryDocuments(enrichedQuery, TOP_K, buildRagTracer());
    } catch (err) {
      logger.warn('QASkill: RAG query failed', { error: err instanceof Error ? err.message : String(err) });
      return this.emptyFragment();
    }

    const relevant = results.filter(r => r.similarity >= SIMILARITY_THRESHOLD);
    if (relevant.length === 0) {
      logger.info('QASkill: no documents above similarity threshold', {
        threshold: SIMILARITY_THRESHOLD,
        topSimilarity: results[0]?.similarity ?? 0,
      });
      return this.emptyFragment();
    }

    logger.info('QASkill: retrieved relevant documents', { count: relevant.length });

    const docBlocks = relevant
      .map(r => `[${r.documentTitle}]\n${r.chunkText}`)
      .join('\n\n');

    const content = `## Reference Documents\n${docBlocks}\n\nInstructions: If the patient asked a question, answer it in your own words using the information from the reference documents above — do not quote verbatim. Summarise clearly and conversationally based on what the patient actually asked. If the documents do not cover the question, say so honestly. IMPORTANT: This response will be read aloud as a voice note, so remove all formatting — no URLs, no markdown, no bullet points, no asterisks, no special characters. Use plain spoken sentences only. Continue symptom monitoring as guided above.`;

    return {
      skillName: this.name,
      content,
      priority: 5,
      isEmpty: false,
    };
  }

  /**
   * Translate a non-English patient message to English for document retrieval.
   * English locales pass through unchanged. On any failure the original message
   * is used (retrieval may still miss, but the turn continues).
   */
  private async toEnglishQuery(message: string, locale: string): Promise<string> {
    if (languageDirective(locale).name === 'English') return message;
    try {
      const res = await this.llm.complete(
        [
          {
            role: 'system',
            content:
              'Translate the patient message to English for a document search. Output ONLY the English translation — no preamble, no quotes. Preserve the medical meaning.',
          },
          { role: 'user', content: message },
        ],
        { temperature: 0, maxTokens: 150 },
      );
      const translated = res.content.trim();
      if (!translated) return message;
      logger.info('QASkill: translated query for retrieval', { locale, original: message, english: translated });
      return translated;
    } catch (err) {
      logger.warn('QASkill: query translation failed, using original', {
        error: err instanceof Error ? err.message : String(err),
      });
      return message;
    }
  }

  private emptyFragment(): ContextFragment {
    return { skillName: this.name, content: '', priority: 5, isEmpty: true };
  }
}
