import { prisma } from './database';
import { logger } from './logger';

export interface TenantFeatures {
  enabledSkills: string[];
  enabledCapabilities: string[];
  welcomeMessage: string | null;
  languageOptions: string[];
}

export interface SkillDefinition {
  name: string;
  label: string;
}

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  { name: 'symptom_check', label: 'Symptom Assessment' },
  { name: 'qa', label: 'FAQ / Knowledge Base' },
];

export interface CapabilityDefinition {
  name: string;
  label: string;
}

export const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  { name: 'screening', label: 'Screening' },
  { name: 'language_selection', label: 'Language Selection' },
];

const KNOWN_SKILLS = new Set(SKILL_DEFINITIONS.map((s) => s.name));
const KNOWN_CAPABILITIES = new Set(CAPABILITY_DEFINITIONS.map((c) => c.name));
const DEFAULT_FEATURES: TenantFeatures = {
  enabledSkills: SKILL_DEFINITIONS.map((s) => s.name),
  enabledCapabilities: [],
  welcomeMessage: null,
  languageOptions: [],
};

export async function getTenantFeatures(tenantId: string): Promise<TenantFeatures> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });

    const features = (tenant?.settings as any)?.features;
    if (!features) return { ...DEFAULT_FEATURES };

    const raw: unknown = features.enabledSkills;
    const enabledSkills = Array.isArray(raw)
      ? (raw as unknown[]).filter((s): s is string => typeof s === 'string' && KNOWN_SKILLS.has(s))
      : [];

    const rawCaps: unknown = features.enabledCapabilities;
    const enabledCapabilities = Array.isArray(rawCaps)
      ? (rawCaps as unknown[]).filter((c): c is string => typeof c === 'string' && KNOWN_CAPABILITIES.has(c))
      : [];

    const rawLangs: unknown = features.languageOptions;
    const languageOptions = Array.isArray(rawLangs)
      ? (rawLangs as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];

    return {
      enabledSkills: enabledSkills.length > 0 ? enabledSkills : [...DEFAULT_FEATURES.enabledSkills],
      enabledCapabilities,
      welcomeMessage: typeof features.welcomeMessage === 'string' ? features.welcomeMessage : null,
      languageOptions,
    };
  } catch (err: any) {
    logger.error('getTenantFeatures: DB error, using defaults', { tenantId, error: err.message });
    return { ...DEFAULT_FEATURES };
  }
}
