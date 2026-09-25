import { LLMProvider } from '../../ai-agent/interfaces';
import { languageDirective } from '../../core/locale-language';

export interface GreetingCopy {
  /** System role message passed to the LLM */
  systemRole: string;
  /**
   * Context sentence for the LLM prompt.
   * null when the timeline should be omitted (e.g. just-enrolled chronic patient).
   */
  contextLine: string | null;
  /** Short phrase describing the purpose of the check-in */
  checkInLine: string;
}

/**
 * Build LLM copy variants based on the patient's trigger type.
 * Used by both SetHealthConditionFlow (WhatsApp greeting) and
 * TestConversationService (voice call greeting) so the language is consistent.
 */
export function buildGreetingCopy(
  triggerType: string,
  conditionName: string,
  daysSinceStart: number,
  timeExpression: string,
): GreetingCopy {
  const isChronic =
    triggerType === 'enrollment_date' || triggerType === 'diagnosis_date';

  if (isChronic) {
    return {
      systemRole:
        'You are a clinical AI nurse following up with a patient on a chronic care programme.',
      // Omit the timeline when the patient just enrolled (daysSinceStart === 0)
      contextLine:
        daysSinceStart > 0
          ? triggerType === 'diagnosis_date'
            ? `It has been ${timeExpression} since the patient was diagnosed with ${conditionName}`
            : `It has been ${timeExpression} since the patient enrolled in the ${conditionName} care programme`
          : null,
      checkInLine: 'checking in on how they are managing their condition',
    };
  }

  // episodic / discharge default (surgery_date, discharge_date, transplant_date, etc.)
  // Timeline omitted: the clinical agenda asks how long it has been since surgery,
  // so stating it in the greeting is redundant.
  return {
    systemRole:
      'You are a clinical AI nurse following up with a post-discharge patient.',
    contextLine: null,
    checkInLine: 'checking in on their recovery',
  };
}

/**
 * Generate a personalised opening greeting via LLM.
 * Single implementation used by all channels (WhatsApp, voice) and eval generation
 * so the greeting wording is identical across every path.
 */
export async function generateGreeting(
  patientName: string,
  conditionName: string,
  daysSinceStart: number,
  locale: string,
  triggerType: string,
  llm: LLMProvider,
): Promise<string> {
  let timeExpression: string;
  if (daysSinceStart <= 1)       timeExpression = '1 day';
  else if (daysSinceStart < 7)   timeExpression = `${daysSinceStart} days`;
  else if (daysSinceStart < 14)  timeExpression = '1 week';
  else if (daysSinceStart < 21)  timeExpression = '2 weeks';
  else if (daysSinceStart < 28)  timeExpression = '3 weeks';
  else if (daysSinceStart < 60)  timeExpression = `${Math.floor(daysSinceStart / 7)} weeks`;
  else {
    const months = Math.floor(daysSinceStart / 30);
    timeExpression = months === 1 ? '1 month' : `${months} months`;
  }

  const copy = buildGreetingCopy(triggerType, conditionName, daysSinceStart, timeExpression);

  const contextSentence = copy.contextLine
    ? `${copy.contextLine}, and I wanted to check in — ${copy.checkInLine}.`
    : `I am ${copy.checkInLine}.`;

  const greetingPrompt = `Write a warm, conversational follow-up message from a member of the patient's care team.

Include: the patient's name ("${patientName}"), your name as a care team member from REAN Foundation (use a real first name like "Maya" or "Priya", with no title or honorific), and the following context: ${contextSentence}

CRITICAL FORMATTING RULES:
- Write as 2-3 natural flowing sentences in a single paragraph
- NO numbered lists, NO bullet points, NO line breaks between sentences, NO headers
- Do NOT use clinical or technical terms
- ${languageDirective(locale).instruction}`;

  try {
    const response = await llm.complete(
      [
        { role: 'system', content: copy.systemRole },
        { role: 'user', content: greetingPrompt },
      ],
      { temperature: 0.7, maxTokens: 150 },
    );
    return response.content;
  } catch {
    return `Hello ${patientName}! This is Maya from REAN Foundation. I wanted to check in on how you are feeling today. How are you doing?`;
  }
}
