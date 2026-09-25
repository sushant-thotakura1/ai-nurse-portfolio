import { MessageState } from '../messaging/session';
import { ClinicalContext } from '../knowledge-graph/context-loader';
import { ChatMessage } from '../ai-agent/interfaces';
import { logger } from '../core/logger';

export interface SessionContext {
  patientId: string;
  condition: string | null;
  classification: string | null;
  currentPhase: string | null;
  locale: string;
  recentTranscript: Array<{ speaker: 'patient' | 'agent'; text: string }>;
  sessionState: MessageState;
  currentMessage: string;
  detectedLocale: string | null;
  // Pre-loaded to avoid duplicate DB calls inside skills
  clinicalCtx: ClinicalContext | null;
  transcriptHistory: ChatMessage[];
  // Symptoms reported this session that still need a follow-up assessment question
  pendingSymptoms?: Array<{ id: string; name: string }>;
  // True when this is the first CONVERSATION-state response (≤1 agent turns in transcript)
  isFirstConversationTurn: boolean;
  // The question this message is answering, when the patient quote-replied to a
  // specific outbound question bubble (WhatsApp swipe-to-reply). Undefined when
  // there is no quote context or the quoted message is unknown/expired (#141).
  replyingToQuestion?: string;
  // Decrypted patient name supplied by the caller; null suppresses the first-turn greeting
  patientName: string | null;
}

export interface ContextFragment {
  skillName: string;
  content: string;
  priority: number;
  isEmpty: boolean;
}

export interface TurnPlan {
  skills: string[];
  reasoning: string;
}

export interface ConversationSkill {
  readonly name: string;
  readonly description: string;
  execute(context: SessionContext, prisma: any): Promise<ContextFragment>;
}

export class ConversationSkillRegistry {
  private readonly skills = new Map<string, ConversationSkill>();

  register(skill: ConversationSkill): void {
    this.skills.set(skill.name, skill);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  getSkillDescriptions(filter?: string[]): string {
    return [...this.skills.values()]
      .filter(s => !filter || filter.includes(s.name))
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');
  }

  async execute(
    plan: TurnPlan,
    context: SessionContext,
    prisma: any,
  ): Promise<ContextFragment[]> {
    const results = await Promise.all(
      plan.skills.map(async (name) => {
        const skill = this.skills.get(name);
        if (!skill) {
          logger.warn('ConversationSkillRegistry: unknown skill in plan, skipping', { name });
          return null;
        }
        try {
          return await skill.execute(context, prisma);
        } catch (err: any) {
          logger.error('ConversationSkillRegistry: skill threw, skipping fragment', {
            skill: name,
            error: err.message,
          });
          return null;
        }
      }),
    );
    return results.filter((r): r is ContextFragment => r !== null);
  }
}
