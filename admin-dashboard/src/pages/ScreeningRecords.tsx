import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import {
  screeningApi,
  ScreeningRecordListItem,
  ScreeningStatusFilter,
} from '../services/screeningApi';
import { useScreeningEnabled } from '../hooks/useScreeningEnabled';
import ScreeningRecordDialog from '../components/ScreeningRecordDialog';

const LIMIT = 25;

const STATUS_OPTIONS: { value: ScreeningStatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'stopped', label: 'Stopped' },
];

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
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ScreeningRecords() {
  const { enabled, loading: gateLoading, error: gateError, retry: recheckGate } = useScreeningEnabled();

  const [records, setRecords] = useState<ScreeningRecordListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<ScreeningStatusFilter>('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await screeningApi.listRecords({ status, limit: LIMIT, offset: page * LIMIT });
      setRecords(result.records);
      setTotal(result.total);
    } catch (e: any) {
      if (e.response?.status === 404) {
        // Screening was toggled off for this tenant mid-session — re-check the
        // gate so the page swaps to the neutral "not enabled" message and the
        // nav item drops on the next /features refresh.
        recheckGate();
        return;
      }
      setError(e.response?.data?.error || 'Failed to load screening records');
    } finally {
      setLoading(false);
    }
  }, [status, page, recheckGate]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await screeningApi.downloadCsv(status);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screening-records-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      if (e.response?.status === 404) {
        recheckGate();
        return;
      }
      setError(e.response?.data?.error || 'Failed to export CSV');
    } finally {
      setDownloading(false);
    }
  };

  const openDetail = (id: string) => {
    setSelectedId(id);
    setDialogOpen(true);
  };

  if (gateLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (gateError) {
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={recheckGate}>
            Retry
          </Button>
        }
      >
        Couldn't check whether screening is enabled.
      </Alert>
    );
  }

  if (!enabled) {
    return <Alert severity="info">Screening is not enabled for this tenant.</Alert>;
  }

  const lastPage = Math.max(0, Math.ceil(total / LIMIT) - 1);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom>Screening Records</Typography>
          <Typography variant="body1" color="text.secondary">
            Adult vaccination screenings submitted for this tenant
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={downloading ? <CircularProgress size={16} /> : <DownloadIcon />}
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Box>

      <Box sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="screening-status-label">Status</InputLabel>
          <Select
            labelId="screening-status-label"
            id="screening-status"
            label="Status"
            value={status}
            onChange={(e) => {
              setPage(0);
              setStatus(e.target.value as ScreeningStatusFilter);
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : records.length === 0 ? (
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            {status === 'all' ? 'No screening records yet.' : 'No records match this filter.'}
          </Typography>
        </Paper>
      ) : (
        <Paper sx={{ width: '100%', overflow: 'hidden' }}>
          <TableContainer>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Submitted</TableCell>
                  <TableCell>Filled by</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Recommendation</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {records.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    onClick={() => openDetail(r.id)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>{fmt(r.createdAt)}</TableCell>
                    <TableCell>{FILLED_BY_LABELS[r.filledBy] ?? r.filledBy}</TableCell>
                    <TableCell>{r.name ?? '—'}</TableCell>
                    <TableCell>{r.phone ?? '—'}</TableCell>
                    <TableCell>
                      <Chip label={r.status.replace('_', ' ')} size="small" color={STATUS_COLORS[r.status] ?? 'default'} />
                    </TableCell>
                    <TableCell>{r.recommendationSummary}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color="primary"
                        aria-label="View record"
                        onClick={() => openDetail(r.id)}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, p: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {total === 0 ? '0' : `${page * LIMIT + 1}–${Math.min((page + 1) * LIMIT, total)}`} of {total}
            </Typography>
            <Button size="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button size="small" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </Box>
        </Paper>
      )}

      <ScreeningRecordDialog
        open={dialogOpen}
        recordId={selectedId}
        onClose={() => setDialogOpen(false)}
      />
    </Box>
  );
}
