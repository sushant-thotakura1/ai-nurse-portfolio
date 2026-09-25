import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Chip,
  Divider,
  CircularProgress,
  Alert,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { screeningApi, ScreeningRecordDetail } from '../services/screeningApi';

interface Props {
  open: boolean;
  recordId: string | null;
  onClose: () => void;
}

const FILLED_BY_LABELS: Record<string, string> = {
  patient: 'Patient',
  family_lar: 'Family / LAR',
  hcw: 'Healthcare worker',
};

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'default'> = {
  completed: 'success',
  stopped: 'warning',
  in_progress: 'default',
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ScreeningRecordDialog({ open, recordId, onClose }: Props) {
  const [detail, setDetail] = useState<ScreeningRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !recordId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    screeningApi
      .getRecord(recordId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.response?.data?.error || 'Failed to load the record');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, recordId]);

  const identifiersEmpty =
    detail &&
    !detail.identifiers.name &&
    !detail.identifiers.phone &&
    !detail.identifiers.externalId &&
    !detail.identifiers.abhaId;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Screening record</Typography>
          <IconButton onClick={onClose} size="small" aria-label="Close">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}

        {detail && !loading && !error && (
          <Box>
            {/* Summary chips */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <Chip label={`Status: ${detail.status.replace('_', ' ')}`} size="small" color={STATUS_COLORS[detail.status] ?? 'default'} />
              <Chip label={`Filled by: ${FILLED_BY_LABELS[detail.filledBy] ?? detail.filledBy}`} size="small" />
              <Chip label={`Submitted: ${fmt(detail.createdAt)}`} size="small" />
            </Box>

            {/* Identifiers */}
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Identifiers
            </Typography>
            {identifiersEmpty ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                None captured
              </Typography>
            ) : (
              <List dense sx={{ mb: 1 }}>
                {detail.identifiers.name && (
                  <ListItem sx={{ px: 0 }}><ListItemText primary="Name" secondary={detail.identifiers.name} /></ListItem>
                )}
                {detail.identifiers.phone && (
                  <ListItem sx={{ px: 0 }}><ListItemText primary="Phone" secondary={detail.identifiers.phone} /></ListItem>
                )}
                {detail.identifiers.externalId && (
                  <ListItem sx={{ px: 0 }}><ListItemText primary="Patient ID" secondary={detail.identifiers.externalId} /></ListItem>
                )}
                {detail.identifiers.abhaId && (
                  <ListItem sx={{ px: 0 }}><ListItemText primary="ABHA number / address" secondary={detail.identifiers.abhaId} /></ListItem>
                )}
              </List>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Answers */}
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Answers
            </Typography>
            {detail.sections.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No answers recorded yet.</Typography>
            ) : (
              detail.sections.map((section) => (
                <Box key={section.title} sx={{ mb: 1.5 }}>
                  <Typography variant="body2" fontWeight="medium">{section.title}</Typography>
                  <List dense>
                    {section.items.map((item, i) => (
                      <ListItem key={i} sx={{ px: 0 }}>
                        <ListItemText primary={item.prompt} secondary={item.answer} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              ))
            )}

            <Divider sx={{ my: 2 }} />

            {/* Recommendation / stop outcome */}
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              {detail.stopOutcome ? 'Stop outcome' : 'Recommendation'}
            </Typography>
            {detail.stopOutcome ? (
              <Alert severity={detail.stopOutcome.outcome === 'defer' ? 'info' : 'warning'}>
                {detail.stopOutcome.message}
              </Alert>
            ) : detail.status === 'in_progress' ? (
              <Typography variant="body2" color="text.secondary">Not yet computed</Typography>
            ) : detail.recommendationLabels && detail.recommendationLabels.length > 0 ? (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {detail.recommendationLabels.map((v) => (
                  <Chip key={v} label={v} size="small" color="primary" variant="outlined" />
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">No vaccines recommended</Typography>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Metadata */}
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Metadata
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Schema: {detail.schemaId} v{detail.schemaVersion}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Created: {fmt(detail.createdAt)} · Updated: {fmt(detail.updatedAt)}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ fontFamily: 'monospace' }}>
              {detail.id}
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
