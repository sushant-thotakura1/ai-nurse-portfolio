import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Collapse,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Stack,
  Chip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  FilterList as FilterListIcon,
  Search as SearchIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import CallLogsTable from '../components/CallLogsTable';
import CallDetailDialog from '../components/CallDetailDialog';
import { CallSession, callApi } from '../services/callApi';

const CHANNEL_OPTIONS = [
  { value: '', label: 'All Channels' },
  { value: 'WHATSAPP_CHAT', label: 'WhatsApp Chat' },
  { value: 'VOICE', label: 'Voice Call' },
];

const OUTCOME_OPTIONS = [
  { value: '', label: 'All Outcomes' },
  { value: 'ESCALATE', label: 'Escalate' },
  { value: 'REASSURE', label: 'Reassure' },
  { value: 'ADVISE', label: 'Advise' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
];

export default function CallLogs() {
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<CallSession | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Filter state
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [channelFilter, setChannelFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [conditionFilter, setConditionFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadCalls = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi.getCallSessions();
      setCalls(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load call logs');
      console.error('Failed to load call logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalls();
  }, []);

  // Distinct conditions across all loaded calls -- derived from the
  // unfiltered `calls` list so the dropdown's options don't shrink to
  // whatever's currently selected.
  const conditionOptions = useMemo(() => {
    const distinct = new Set<string>();
    for (const call of calls) {
      if (call.patient?.condition) distinct.add(call.patient.condition);
    }
    return Array.from(distinct).sort();
  }, [calls]);

  const filteredCalls = useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
    // dateTo is a date string like "2026-07-22"; treat it as end-of-day
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null;

    return calls.filter((call) => {
      // Channel filter
      if (channelFilter) {
        const isWhatsApp = call.callPurpose?.toUpperCase() === 'WHATSAPP_CHAT';
        if (channelFilter === 'WHATSAPP_CHAT' && !isWhatsApp) return false;
        if (channelFilter === 'VOICE' && isWhatsApp) return false;
      }

      // Outcome filter
      if (outcomeFilter) {
        if (outcomeFilter === 'IN_PROGRESS') {
          if (call.outcome) return false;
        } else {
          if ((call.outcome?.toUpperCase() ?? '') !== outcomeFilter) return false;
        }
      }

      // Condition filter
      if (conditionFilter && call.patient?.condition !== conditionFilter) return false;

      // Date range filter on startedAt
      const startedTs = new Date(call.startedAt).getTime();
      if (fromTs !== null && startedTs < fromTs) return false;
      if (toTs !== null && startedTs > toTs) return false;

      // Search filter — patient name or phone
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = call.patient?.name?.toLowerCase().includes(q);
        const phoneMatch = call.patient?.phoneNumber?.includes(q);
        if (!nameMatch && !phoneMatch) return false;
      }

      return true;
    });
  }, [calls, channelFilter, outcomeFilter, conditionFilter, searchQuery, dateFrom, dateTo]);

  const activeFilterCount = [channelFilter, outcomeFilter, conditionFilter, searchQuery.trim(), dateFrom, dateTo].filter(Boolean).length;

  const clearFilters = () => {
    setChannelFilter('');
    setOutcomeFilter('');
    setConditionFilter('');
    setSearchQuery('');
    setDateFrom('');
    setDateTo('');
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const enriched = await callApi.exportCallLogs({
        channel: channelFilter || undefined,
        outcome: outcomeFilter || undefined,
        condition: conditionFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        sessionIds: filteredCalls.map((call) => call.id),
      });
      const blob = new Blob([JSON.stringify(enriched, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `call-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to export call logs');
      console.error('Failed to export call logs:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleViewCall = (call: CallSession) => {
    setSelectedCall(call);
    setDetailDialogOpen(true);
  };

  const handleCloseDetail = () => {
    setDetailDialogOpen(false);
    setSelectedCall(null);
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4" gutterBottom>
            Call Logs
          </Typography>
          <Typography variant="body1" color="text.secondary">
            View call history, transcripts, and clinical events
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={downloading ? <CircularProgress size={16} /> : <DownloadIcon />}
            onClick={handleDownload}
            disabled={loading || downloading || filteredCalls.length === 0}
          >
            {downloading ? 'Fetching…' : 'Download JSON'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<FilterListIcon />}
            onClick={() => setFiltersOpen((prev) => !prev)}
            endIcon={
              activeFilterCount > 0 ? (
                <Chip
                  label={activeFilterCount}
                  size="small"
                  color="primary"
                  sx={{ height: 18, fontSize: 11 }}
                />
              ) : undefined
            }
          >
            Filters
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadCalls}
            disabled={loading}
          >
            Refresh
          </Button>
        </Stack>
      </Box>

      {/* Collapsible filter panel */}
      <Collapse in={filtersOpen}>
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            flexWrap: 'wrap',
            alignItems: 'center',
            mb: 2,
            p: 2,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
          }}
        >
          <TextField
            size="small"
            placeholder="Search by name or phone"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} /> }}
            sx={{ minWidth: 220 }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Channel</InputLabel>
            <Select
              label="Channel"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
            >
              {CHANNEL_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Outcome</InputLabel>
            <Select
              label="Outcome"
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
            >
              {OUTCOME_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Condition</InputLabel>
            <Select
              label="Condition"
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
            >
              <MenuItem value="">All Conditions</MenuItem>
              {conditionOptions.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 150 }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: dateFrom || undefined }}
            sx={{ minWidth: 150 }}
          />
          {activeFilterCount > 0 && (
            <Button size="small" onClick={clearFilters} sx={{ ml: 'auto' }}>
              Clear filters
            </Button>
          )}
        </Box>
      </Collapse>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <CallLogsTable
          calls={filteredCalls}
          totalCount={calls.length}
          onViewCall={handleViewCall}
        />
      )}

      <CallDetailDialog
        open={detailDialogOpen}
        call={selectedCall}
        onClose={handleCloseDetail}
      />
    </Box>
  );
}
