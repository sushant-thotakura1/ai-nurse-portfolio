import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  TablePagination,
  Box,
  Typography,
  Tooltip,
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  Phone as PhoneIcon,
  Timer as TimerIcon,
  ContentCopy as ContentCopyIcon,
  Feedback as FeedbackIcon,
} from '@mui/icons-material';
import { CallSession } from '../services/callApi';

interface CallLogsTableProps {
  calls: CallSession[];
  totalCount: number;
  onViewCall: (call: CallSession) => void;
}

export default function CallLogsTable({ calls, totalCount, onViewCall }: CallLogsTableProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const getOutcomeColor = (outcome?: string) => {
    switch (outcome?.toUpperCase()) {
      case 'COMPLETED':  return 'success';
      case 'REASSURE':   return 'success';
      case 'ADVISE':     return 'warning';
      case 'ESCALATE':
      case 'ESCALATED':  return 'error';
      case 'FAILED':
      case 'TIMEOUT':    return 'error';
      default:           return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getChannelLabel = (callPurpose: string): { label: string; color: 'default' | 'primary' | 'success' | 'info' } => {
    switch (callPurpose?.toUpperCase()) {
      case 'WHATSAPP_CHAT': return { label: 'WhatsApp Chat', color: 'success' };
      default:              return { label: 'Voice Call', color: 'primary' };
    }
  };

  const formatPhaseKey = (phaseKey: string) =>
    phaseKey.split(':')[0].trim().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const phaseColor = (days: number): 'error' | 'warning' | 'info' | 'success' =>
    days <= 7 ? 'error' : days <= 30 ? 'warning' : days <= 90 ? 'info' : 'success';

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return 'N/A';
    if (seconds >= 3600) {
      const hours = Math.floor(seconds / 3600);
      const mins  = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${mins}m`;
    }
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  };

  if (calls.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          No call logs found{totalCount > 0 ? ' matching the current filters' : ''}.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <TableContainer>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Patient</TableCell>
              <TableCell>Condition</TableCell>
              <TableCell>Days Since Surgery</TableCell>
              <TableCell>Channel</TableCell>
              <TableCell>Started At</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Outcome</TableCell>
              <TableCell>Locale</TableCell>
              <TableCell>Session ID</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {calls
              .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
              .map((call) => (
                <TableRow key={call.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PhoneIcon fontSize="small" color="action" />
                      <Box>
                        <Typography variant="body2">
                          {call.patient?.name || 'Unknown'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {call.patient?.phoneNumber || call.patientId}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>

                  <TableCell>
                    {call.patient?.condition ? (
                      <Box>
                        <Chip
                          label={call.patient.condition}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                        {call.patient.classification && (
                          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                            {call.patient.classification}
                          </Typography>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">N/A</Typography>
                    )}
                  </TableCell>

                  <TableCell>
                    {(() => {
                      // Prefer persisted phase from KG over computed fallback
                      if (call.currentPhase != null && call.daysSinceStart != null) {
                        return (
                          <Box>
                            <Typography variant="body2" fontWeight="medium">Day {call.daysSinceStart}</Typography>
                            <Chip label={formatPhaseKey(call.currentPhase)} size="small" color={phaseColor(call.daysSinceStart)} sx={{ mt: 0.5 }} />
                          </Box>
                        );
                      }
                      if (call.patient?.conditionStartDate) {
                        const daysSince = Math.floor(
                          (new Date(call.startedAt).getTime() - new Date(call.patient!.conditionStartDate!).getTime()) /
                            (1000 * 60 * 60 * 24)
                        );
                        let phase = 'Phase I';
                        if      (daysSince <= 7)  { phase = 'Phase I'; }
                        else if (daysSince <= 30) { phase = 'Phase II'; }
                        else if (daysSince <= 90) { phase = 'Phase III'; }
                        else                      { phase = 'Post-Recovery'; }
                        return (
                          <Box>
                            <Typography variant="body2" fontWeight="medium">Day {daysSince}</Typography>
                            <Chip label={phase} size="small" color={phaseColor(daysSince)} sx={{ mt: 0.5 }} />
                          </Box>
                        );
                      }
                      return <Typography variant="body2" color="text.secondary">N/A</Typography>;
                    })()}
                  </TableCell>

                  <TableCell>
                    {(() => {
                      const ch = getChannelLabel(call.callPurpose);
                      return <Chip label={ch.label} size="small" color={ch.color} />;
                    })()}
                  </TableCell>

                  <TableCell>{formatDate(call.startedAt)}</TableCell>

                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <TimerIcon fontSize="small" color="action" />
                      {formatDuration(call.durationSeconds)}
                    </Box>
                  </TableCell>

                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Chip
                        label={call.outcome || 'IN PROGRESS'}
                        color={getOutcomeColor(call.outcome)}
                        size="small"
                      />
                      {call.feedbackText && (
                        <Tooltip title={`Patient feedback: "${call.feedbackText}"`} arrow>
                          <FeedbackIcon fontSize="small" color="action" sx={{ cursor: 'default' }} />
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>

                  <TableCell>
                    <Chip label={call.locale} size="small" />
                  </TableCell>

                  <TableCell>
                    {call.messageSessionId ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', color: 'text.secondary' }}
                          title={call.messageSessionId}
                        >
                          {call.messageSessionId.slice(0, 8)}…
                        </Typography>
                        <Tooltip title="Copy session ID">
                          <IconButton
                            size="small"
                            onClick={() => navigator.clipboard.writeText(call.messageSessionId!)}
                          >
                            <ContentCopyIcon sx={{ fontSize: 12 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    )}
                  </TableCell>

                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => onViewCall(call)}
                      color="primary"
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={calls.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </Paper>
  );
}
