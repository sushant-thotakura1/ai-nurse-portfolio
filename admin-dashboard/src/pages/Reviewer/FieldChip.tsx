// admin-dashboard/src/pages/Reviewer/FieldChip.tsx
import { useEffect, useState } from 'react';
import { Box, Chip, ClickAwayListener, Paper, TextField, Button, Typography } from '@mui/material';

export interface ChipDecision {
  field: string;
  decision: 'correct' | 'needs_change';
  comment?: string;
}

interface Props {
  field: string;
  expectedValue?: unknown;
  decision?: ChipDecision;
  onDecide: (d: ChipDecision) => void;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  popupDirection?: 'down' | 'up';
}

export default function FieldChip({ field, expectedValue, decision, onDecide, isOpen, onOpen, onClose, popupDirection = 'down' }: Props) {
  const [comment, setComment] = useState(decision?.comment ?? '');

  useEffect(() => {
    setComment(decision?.comment ?? '');
  }, [decision?.comment]);

  const decided = !!decision;
  const isCorrect = decision?.decision === 'correct';

  const chipColor = !decided ? 'default' : isCorrect ? 'success' : 'warning';
  const chipLabel = !decided ? `○ ${field}` : isCorrect ? `✓ ${field}` : `✗ ${field}`;

  return (
    <ClickAwayListener onClickAway={() => { if (isOpen) onClose(); }}>
      <Box sx={{ display: 'inline-block', position: 'relative' }}>
        <Chip
          label={chipLabel}
          color={chipColor}
          size="small"
          onClick={() => isOpen ? onClose() : onOpen()}
          sx={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
        />
        {isOpen && (
          <Paper elevation={4} sx={{ position: 'absolute', zIndex: 1300, ...(popupDirection === 'up' ? { bottom: '100%', mb: 0.5 } : { top: '100%', mt: 0.5 }), left: 0, p: 1.5, minWidth: 260 }}>
            <Typography variant="caption" fontWeight={700} display="block" mb={0.5}>
              Reviewing: <em>{field}</em>
            </Typography>
            {expectedValue !== undefined && (
              <Box sx={{ mb: 1, p: 0.75, borderRadius: 1, bgcolor: 'grey.100' }}>
                <Typography variant="caption" color="text.secondary" display="block">Expected:</Typography>
                <Typography variant="caption" fontFamily="monospace">
                  {typeof expectedValue === 'object'
                    ? JSON.stringify(expectedValue)
                    : String(expectedValue)}
                </Typography>
              </Box>
            )}
            <TextField
              multiline
              minRows={2}
              fullWidth
              size="small"
              placeholder="Optional comment if something needs changing…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1, justifyContent: 'flex-end' }}>
              <Button
                size="small"
                variant="contained"
                color="success"
                onClick={() => { onDecide({ field, decision: 'correct' }); onClose(); }}
              >
                ✓ Looks correct
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() => { onDecide({ field, decision: 'needs_change', comment: comment || undefined }); onClose(); }}
              >
                ✗ Needs change
              </Button>
            </Box>
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  );
}
