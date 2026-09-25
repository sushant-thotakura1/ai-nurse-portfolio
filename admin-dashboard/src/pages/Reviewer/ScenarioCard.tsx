// admin-dashboard/src/pages/Reviewer/ScenarioCard.tsx
import { useState } from 'react';
import { Box, Paper, Typography, Collapse, Button, CircularProgress } from '@mui/material';
import RowReviewPanel from './RowReviewPanel';
import { ChipDecision } from './FieldChip';

export interface ParsedRow {
  row_type: 'greeting' | 'turn' | 'assessment';
  turn_number?: string;
  expected: string;
  patient_says?: string;
  nurse_says?: string;
  scenario_id: string;
}

export interface ScenarioCardProps {
  scenarioId: string;
  flagPath: 'green' | 'yellow' | 'red';
  description: string;
  rows: ParsedRow[];
  existingDecisions: Record<string, Record<string, ChipDecision>>;  // row_key → field → decision
  onDecide: (rowKey: string, field: string, decision: 'correct' | 'needs_change', comment?: string) => Promise<void>;
  onApprove: (scenarioId: string) => Promise<void>;
}

const FLAG_COLORS: Record<string, string> = { green: '#4caf50', yellow: '#ff9800', red: '#f44336' };

function rowKey(row: ParsedRow): string {
  return row.row_type === 'turn' ? `turn_${row.turn_number}` : row.row_type;
}

export default function ScenarioCard({ scenarioId, flagPath, description, rows, existingDecisions, onDecide, onApprove }: ScenarioCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);

  // Count total fields across all rows
  const totalFields = rows.reduce((sum, row) => {
    try { return sum + Object.keys(JSON.parse(row.expected)).length; } catch { return sum; }
  }, 0);

  const decidedFields = Object.values(existingDecisions).reduce((sum, rowDecisions) =>
    sum + Object.keys(rowDecisions).length, 0);

  const allDecided = totalFields > 0 && decidedFields >= totalFields;

  const handleApprove = async () => {
    setApproving(true);
    await onApprove(scenarioId);
    setApproving(false);
  };

  return (
    <Paper variant="outlined" sx={{ mb: 1, overflow: 'hidden' }}>
      <Box
        component="button"
        type="button"
        aria-expanded={expanded}
        aria-controls={`scenario-collapse-${scenarioId}`}
        sx={{
          px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5,
          cursor: 'pointer', width: '100%', textAlign: 'left', border: 'none',
          background: 'transparent',
          '&:hover': { bgcolor: 'grey.50' },
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: FLAG_COLORS[flagPath], flexShrink: 0 }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" fontWeight={600}>{scenarioId}</Typography>
          <Typography variant="caption" color="text.secondary">{description}</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">{expanded ? '▼' : '▶'} {decidedFields}/{totalFields}</Typography>
      </Box>

      <Collapse in={expanded} id={`scenario-collapse-${scenarioId}`}>
        <Box sx={{ px: 2, py: 1.5 }}>
          {rows.map((row) => (
            <RowReviewPanel
              key={rowKey(row)}
              row={row}
              decisions={existingDecisions[rowKey(row)] ?? {}}
              onDecide={(field, decision, comment) => onDecide(rowKey(row), field, decision, comment)}
            />
          ))}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, gap: 1 }}>
            <Button size="small" variant="outlined" onClick={() => setExpanded(false)}>Skip for now</Button>
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={!allDecided || approving}
              onClick={handleApprove}
              startIcon={approving ? <CircularProgress size={14} /> : null}
            >
              ✓ Approve scenario ({decidedFields}/{totalFields})
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}
