import { ConversationSkill, SessionContext, ContextFragment } from '../conversation-skill';
import { languageDirective } from '../../core/locale-language';

export class SymptomCheckSkill implements ConversationSkill {
  readonly name = 'symptom_check';
  readonly description = 'Patient is reporting symptoms, feelings, pain, or health status updates';

  async execute(context: SessionContext, _prisma: any): Promise<ContextFragment> {
    let content = context.clinicalCtx?.systemPrompt
      ?? `You are a clinical AI nurse. Conduct a health check conversation with the patient. Ask one question at a time. ${languageDirective(context.locale).instruction}`;

    if (context.isFirstConversationTurn && context.patientName && context.clinicalCtx) {
      // The timeline is deliberately not stated: the clinical agenda asks how long it has been since surgery.
      content += `\n\n---\n\nOPENING GREETING: This is the very first exchange of this conversation. Begin your response with a warm, personalized greeting (2-3 sentences) before moving to any clinical questions:\n1. Address the patient by name: "${context.patientName}"\n2. Introduce yourself as a member of the patient's care team from REAN Foundation (use a real first name like "Maya" — no placeholders, no title or honorific)\n3. Say you are calling to check on their recovery. Do NOT mention how long it has been since the surgery.\nThen ask the first clinical question.`;
    }

    if (context.pendingSymptoms && context.pendingSymptoms.length > 0) {
      const symptomNames = context.pendingSymptoms.map(s => s.name).join(', ');
      content += `\n\n---\n\nPENDING SYMPTOM ASSESSMENT: The patient has reported the following symptom(s) that still need a clinical follow-up: ${symptomNames}. After addressing their current message, ask ONE focused follow-up question about this symptom (e.g., severity on a scale of 1–10, how long it has been present, whether it is constant or intermittent, or what makes it better or worse).`;
    }

    return {
      skillName: this.name,
      content,
      priority: 10,
      isEmpty: false,
    };
  }
}
