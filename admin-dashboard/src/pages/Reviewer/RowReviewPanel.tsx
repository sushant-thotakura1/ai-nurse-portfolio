// admin-dashboard/src/pages/Reviewer/RowReviewPanel.tsx
import { useState } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import FieldChip, { ChipDecision } from './FieldChip';

interface RowData {
  row_type: 'greeting' | 'turn' | 'assessment';
  turn_number?: string;
  expected: string;         // JSON string
  patient_says?: string;
  nurse_says?: string;
  condition?: string;
  phase?: string;
  days_since_start?: string;
  flag_path?: string;
}

interface Props {
  row: RowData;
  decisions: Record<string, ChipDecision>;  // keyed by field name
  onDecide: (field: string, decision: 'correct' | 'needs_change', comment?: string) => void;
}

const RISK_COLORS: Record<string, string> = {
  LOW: '#4caf50', MEDIUM: '#ff9800', HIGH: '#f44336', CRITICAL: '#9c27b0',
};
const OUTCOME_COLORS: Record<string, string> = {
  REASSURE: '#4caf50', ADVISE: '#ff9800', ESCALATE: '#f44336',
};
const FLAG_COLORS: Record<string, string> = {
  green: '#4caf50', yellow: '#ff9800', red: '#f44336',
};

function AssessmentSummary({ expected }: { expected: Record<string, unknown> }) {
  const outcome = expected.outcome as string | undefined;
  const risk = expected.overall_risk_level as string | undefined;
  const action = expected.patient_action as string | undefined;
  const perSymptomFlags = expected.per_symptom_flags as Record<string, string> | undefined;
  const perSymptomOutcomes = expected.per_symptom_outcomes as Record<string, string> | undefined;
  const redFlag = expected.red_flag_triggered as boolean | undefined;
  const escalation = expected.escalation_required as boolean | undefined;

  const symptoms = Object.keys(perSymptomFlags ?? perSymptomOutcomes ?? {});

  return (
    <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #eee', bgcolor: '#fafafa' }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={1}>
        Assessment summary
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: symptoms.length ? 1 : 0 }}>
        {outcome && (
          <Chip size="small" label={`Outcome: ${outcome}`}
            sx={{ bgcolor: OUTCOME_COLORS[outcome] ?? '#9e9e9e', color: '#fff', fontWeight: 700, fontSize: 11 }} />
        )}
        {risk && (
          <Chip size="small" label={`Risk: ${risk}`}
            sx={{ bgcolor: RISK_COLORS[risk] ?? '#9e9e9e', color: '#fff', fontWeight: 700, fontSize: 11 }} />
        )}
        {action && (
          <Chip size="small" label={`Action: ${action}`} variant="outlined"
            sx={{ fontWeight: 600, fontSize: 11 }} />
        )}
        {redFlag !== undefined && (
          <Chip size="small" label={redFlag ? '🚩 Red flag triggered' : 'No red flag'}
            sx={{ bgcolor: redFlag ? '#f44336' : '#e0e0e0', color: redFlag ? '#fff' : 'inherit', fontSize: 11 }} />
        )}
        {escalation !== undefined && escalation && (
          <Chip size="small" label="Escalation required"
            sx={{ bgcolor: '#f44336', color: '#fff', fontSize: 11 }} />
        )}
      </Box>
      {symptoms.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {symptoms.map((sym) => {
            const flag = perSymptomFlags?.[sym];
            const symOutcome = perSymptomOutcomes?.[sym];
            return (
              <Chip key={sym} size="small"
                label={`${sym}: ${flag ?? symOutcome}`}
                sx={{
                  bgcolor: flag ? (FLAG_COLORS[flag] ?? '#9e9e9e') : (OUTCOME_COLORS[symOutcome ?? ''] ?? '#9e9e9e'),
                  color: '#fff', fontSize: 10,
                }} />
            );
          })}
        </Box>
      )}
    </Box>
  );
}

export default function RowReviewPanel({ row, decisions, onDecide }: Props) {
  const [openField, setOpenField] = useState<string | null>(null);

  let expectedObj: Record<string, unknown> = {};
  let parseError = false;
  try { expectedObj = JSON.parse(row.expected); } catch { parseError = true; }

  const entries = Object.entries(expectedObj);
  const rowLabel = row.row_type === 'turn'
    ? `Turn ${row.turn_number}`
    : row.row_type.charAt(0).toUpperCase() + row.row_type.slice(1);

  const rowColor = row.row_type === 'greeting' ? '#e3f2fd'
    : row.row_type === 'turn' ? '#fff8e1' : '#fce4ec';

  const contextParts = [
    row.condition,
    row.phase,
    row.days_since_start ? `Day ${row.days_since_start}` : undefined,
    row.flag_path ? `${row.flag_path} path` : undefined,
  ].filter(Boolean);

  return (
    <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, overflow: 'visible', mb: 1 }}>
      <Box sx={{ px: 2, py: 1, background: rowColor, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" fontWeight={700} textTransform="uppercase" letterSpacing={0.5}>
          {rowLabel}
        </Typography>
        {contextParts.length > 0 && (
          <Typography variant="caption" color="text.secondary">{contextParts.join(' · ')}</Typography>
        )}
      </Box>

      {row.patient_says && (
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #eee', background: '#fafafa' }}>
          <Typography variant="caption" color="text.secondary">Patient said:</Typography>
          <Typography variant="body2" fontStyle="italic">"{row.patient_says}"</Typography>
        </Box>
      )}
      {row.nurse_says && (
        <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #eee', background: '#e8f5e9' }}>
          <Typography variant="caption" color="text.secondary">Nurse said:</Typography>
          <Typography variant="body2">"{row.nurse_says}"</Typography>
        </Box>
      )}

      {row.row_type === 'assessment' && !parseError && (
        <AssessmentSummary expected={expectedObj} />
      )}

      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" mb={1}>
          Expected — click any field to review
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {parseError ? (
            <Typography variant="caption" color="error">
              Could not parse expected JSON — this row may have been generated incorrectly.
            </Typography>
          ) : (
            entries.map(([field, value]) => (
              <FieldChip
                key={field}
                field={field}
                expectedValue={value}
                decision={decisions[field]}
                onDecide={(d) => onDecide(d.field, d.decision, d.comment)}
                isOpen={openField === field}
                onOpen={() => setOpenField(field)}
                onClose={() => setOpenField(null)}
                popupDirection={row.row_type === 'assessment' ? 'up' : 'down'}
              />
            ))
          )}
        </Box>
      </Box>
    </Box>
  );
}
