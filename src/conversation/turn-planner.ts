import { LLMProvider } from '../ai-agent/interfaces';
import { logger } from '../core/logger';
import { SessionContext, TurnPlan, ConversationSkillRegistry } from './conversation-skill';

export class TurnPlanner {
  constructor(
    private readonly llm: LLMProvider,
    private readonly registry: ConversationSkillRegistry,
  ) {}

  async plan(context: SessionContext, enabledSkills?: string[]): Promise<TurnPlan> {
    const systemPrompt = this.buildPrompt(context, enabledSkills);

    let raw: string;
    try {
      const response = await this.llm.complete(
        [{ role: 'system', content: systemPrompt }],
        { maxTokens: 150, temperature: 0 },
      );
      raw = response.content.trim();
    } catch (err: any) {
      logger.warn('TurnPlanner: LLM call failed, using fallback', { error: err.message });
      return { skills: [this.fallbackSkill(enabledSkills)], reasoning: 'fallback: TurnPlanner LLM call failed' };
    }

    try {
      // Extract JSON from response (LLM may wrap it in backticks)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('no JSON object found');
      const parsed = JSON.parse(jsonMatch[0]) as { skills: string[]; reasoning: string };
      if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
        throw new Error('skills must be a non-empty array');
      }
      const allowed = enabledSkills ? new Set(enabledSkills) : null;
      const known = parsed.skills.filter(s => this.registry.has(s) && (!allowed || allowed.has(s)));
      const unknown = parsed.skills.filter(s => !this.registry.has(s) || (allowed && !allowed.has(s)));
      if (unknown.length > 0) {
        logger.warn('TurnPlanner: LLM returned unknown/disallowed skills, dropping', { unknown });
      }
      const skills = known.length > 0 ? known : [this.fallbackSkill(enabledSkills)];
      const plan: TurnPlan = { skills, reasoning: parsed.reasoning ?? '' };
      logger.info('TurnPlanner: plan resolved', { skills: plan.skills, reasoning: plan.reasoning });
      return plan;
    } catch (err: any) {
      logger.warn('TurnPlanner: JSON parse failed, using fallback', { raw, error: err.message });
      return { skills: [this.fallbackSkill(enabledSkills)], reasoning: 'fallback: LLM returned invalid JSON' };
    }
  }

  private fallbackSkill(enabledSkills?: string[]): string {
    return enabledSkills?.[0] ?? 'symptom_check';
  }

  private buildPrompt(context: SessionContext, enabledSkills?: string[]): string {
    const transcriptLines = context.recentTranscript
      .map(t => `${t.speaker === 'patient' ? 'Patient' : 'Nurse'}: ${t.text}`)
      .join('\n');

    return `You are a clinical AI nurse turn planner. Given the patient context and their current message, decide which skills are needed to handle this turn.

Patient context:
- Condition: ${context.condition ?? 'unknown'} (${context.classification ?? 'unknown'}), Phase: ${context.currentPhase ?? 'unknown'}
- Locale: ${context.locale}
- Recent conversation:
${transcriptLines || '(no prior turns)'}

Current message: "${context.currentMessage}"

Available skills:
${this.registry.getSkillDescriptions(enabledSkills)}

Rules:
- Select ALL skills that apply. A message can need multiple skills simultaneously.
- Consider the full conversation history, not just the current message.
- If a symptom or health status is mentioned alongside a question, include both skills.

Return JSON only, no explanation outside JSON: { "skills": ["skill_a", "skill_b"], "reasoning": "one sentence" }`;
  }
}
