import { contextLoader, ClinicalContext } from '../knowledge-graph/context-loader';
import { knowledgeGraphService } from '../knowledge-graph/knowledge-graph.service';
import { TranscriptAssessmentService } from '../ai-agent/clinical/transcript-assessment.service';
import { generateTurnResponse } from '../ai-agent/clinical/turn-response';
import { generateGreeting } from '../messaging/bot-flows/greeting-copy';
import { Turn } from '../orchestrator/session';
import {
  GreetingInput, GreetingOutput,
  TurnInput, TurnOutput,
  AssessmentInput, AssessmentOutput,
} from './types';
import { LLMProvider, ChatMessage } from '../ai-agent/interfaces';

// ── Assessment ────────────────────────────────────────────────────────────────

function chatMessagesToTurns(messages: ChatMessage[]): Turn[] {
  return messages.map((m, i) => ({
    turnNumber: i + 1,
    speaker: m.role === 'assistant' ? 'agent' : 'patient',
    originalText: m.content,
    timestamp: new Date(),
  }));
}

export async function computeAssessment(
  input: AssessmentInput,
  llm: LLMProvider,
): Promise<AssessmentOutput> {
  const ctx: ClinicalContext | null = await contextLoader.loadContext(
    input.condition,
    input.classification,
    input.days_since_start,
    input.locale,
    undefined,
    input.is_reentry ?? false,
    input.trigger_type_used,
  );

  if (!ctx) {
    throw new Error(`No active knowledge graph found for condition: ${input.condition}`);
  }

  const kg = await knowledgeGraphService.getActiveKnowledgeGraph(input.condition);
  if (!kg) {
    throw new Error(`No active knowledge graph found for condition: ${input.condition}`);
  }

  // No prisma / identity: eval replay has no real patient to persist
  // against, and TranscriptAssessmentService resolves facts from this
  // transcript's own extraction alone when identity is absent.
  const assessor = new TranscriptAssessmentService(llm);
  const turns = chatMessagesToTurns(input.transcript);
  const { assessment } = await assessor.assess(
    turns,
    kg,
    input.classification,
    ctx.patientContext.currentPhase,
    input.days_since_start,
  );
  return assessment;
}

// ── Greeting & Turn ───────────────────────────────────────────────────────────

export async function runGreeting(
  input: GreetingInput,
  llm: LLMProvider,
): Promise<GreetingOutput> {
  const nurse_greeting = await generateGreeting(
    input.patient_name ?? 'patient',
    input.condition,
    input.days_since_start,
    input.locale,
    input.trigger_type_used ?? 'surgery_date',
    llm,
  );
  return { nurse_greeting, system_prompt_used: '' };
}

export async function runTurn(
  input: TurnInput,
  llm: LLMProvider,
): Promise<TurnOutput> {
  const ctx: ClinicalContext | null = await contextLoader.loadContext(
    input.condition,
    input.classification,
    input.days_since_start,
    input.locale,
    undefined,
    input.is_reentry ?? false,
    input.trigger_type_used,
  );

  if (!ctx) {
    throw new Error(`No active knowledge graph found for condition: ${input.condition}`);
  }

  const nurseText = await generateTurnResponse(ctx, input.history, llm);

  const extractionMessages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a clinical analyst. Given a nurse message, return a JSON array of clinical topic keys the nurse addressed. Use snake_case symptom names. Return ONLY a valid JSON array, no other text.',
    },
    {
      role: 'user',
      content: `Nurse said: "${nurseText}"\n\nReturn the JSON array of topics covered:`,
    },
  ];

  let topics_covered: string[] = [];
  try {
    const extractionResponse = await llm.complete(extractionMessages, { temperature: 0, maxTokens: 200 });
    const parsed: unknown = JSON.parse(extractionResponse.content);
    if (Array.isArray(parsed)) {
      topics_covered = parsed as string[];
    }
  } catch {
    topics_covered = [];
  }

  return { nurse_response: nurseText, topics_covered };
}
