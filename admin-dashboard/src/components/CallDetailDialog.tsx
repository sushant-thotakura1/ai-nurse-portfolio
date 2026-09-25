import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Tabs,
  Tab,
  Typography,
  Chip,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
  Card,
  CardContent,
  Grid,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  LocalHospital as HospitalIcon,
  ContentCopy as ContentCopyIcon,
  Feedback as FeedbackIcon,
} from '@mui/icons-material';
import TranscriptViewer from './TranscriptViewer';
import { CallSession, Transcript, ClinicalEvent, callApi } from '../services/callApi';

interface CallDetailDialogProps {
  open: boolean;
  call: CallSession | null;
  onClose: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: 2 }}>{children}</Box>}
    </div>
  );
}

export default function CallDetailDialog({ open, call, onClose }: CallDetailDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [events, setEvents] = useState<ClinicalEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (call) {
      loadCallDetails();
    }
  }, [call]);

  const loadCallDetails = async () => {
    if (!call) return;

    setLoading(true);
    try {
      const [transcriptData, eventsData] = await Promise.all([
        callApi.getTranscripts(call.id),
        callApi.getClinicalEvents(call.id),
      ]);
      setTranscripts(transcriptData);
      setEvents(eventsData);
    } catch (error) {
      console.error('Failed to load call details:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPhaseKey = (phaseKey: string) =>
    phaseKey.split(':')[0].trim().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const phaseColorFromDays = (days: number): 'error' | 'warning' | 'info' | 'success' =>
    days <= 7 ? 'error' : days <= 30 ? 'warning' : days <= 90 ? 'info' : 'success';

  const resolvePhase = (call: CallSession): { days: number; label: string } | null => {
    if (call.currentPhase != null && call.daysSinceStart != null) {
      return { days: call.daysSinceStart, label: formatPhaseKey(call.currentPhase) };
    }
    if (call.patient?.conditionStartDate) {
      const days = Math.floor(
        (new Date(call.startedAt).getTime() - new Date(call.patient.conditionStartDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      let label = 'Phase I';
      if      (days <= 7)  { label = 'Phase I'; }
      else if (days <= 30) { label = 'Phase II'; }
      else if (days <= 90) { label = 'Phase III'; }
      else                 { label = 'Post-Recovery'; }
      return { days, label };
    }
    return null;
  };

  const getChannelLabel = (callPurpose: string): string => {
    switch (callPurpose?.toUpperCase()) {
      case 'WHATSAPP_CHAT': return 'WhatsApp Chat';
      default:              return 'Voice Call';
    }
  };

  const getRiskColor = (riskScore?: string) => {
    switch (riskScore?.toUpperCase()) {
      case 'CRITICAL':
      case 'SEVERE':
        return 'error';
      case 'HIGH':
        return 'error';
      case 'MODERATE':
      case 'MEDIUM':
      case 'MODERATE':
        return 'info';
      case 'LOW':
      case 'MILD':
        return 'success';
      default:
        return 'default';
    }
  };

  const getOutcomeConfig = (outcome: string) => {
    switch (outcome?.toUpperCase()) {
      case 'ESCALATE':
        return {
          color: 'error' as const,
          icon: <WarningIcon />,
          label: 'Escalation Required',
          description: 'Immediate medical attention needed',
        };
      case 'ADVISE':
        return {
          color: 'warning' as const,
          icon: <InfoIcon />,
          label: 'Advice Given',
          description: 'Guidance provided, monitoring recommended',
        };
      case 'REASSURE':
        return {
          color: 'success' as const,
          icon: <CheckCircleIcon />,
          label: 'Patient Reassured',
          description: 'Normal recovery, no concerns',
        };
      case 'COMPLETED':
        return {
          color: 'success' as const,
          icon: <CheckCircleIcon />,
          label: 'Call Completed',
          description: 'Health check-in completed — no escalation required',
        };
      default:
        return {
          color: 'default' as const,
          icon: <HospitalIcon />,
          label: outcome || 'In Progress',
          description: 'Assessment in progress',
        };
    }
  };

  const renderClinicalOverview = () => {
    if (events.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          No clinical events recorded
        </Typography>
      );
    }

    // Group events by type.
    // Voice-call agent writes: SYMPTOM_REPORTED, SYMPTOM_ASSESSMENT
    // Session reaper writes:   SYMPTOM_CHECK, MED_ADHERENCE, RISK_ASSESSMENT
    const symptomEvents = events.filter((e) =>
      e.eventType === 'SYMPTOM_REPORTED' || e.eventType === 'SYMPTOM_CHECK'
    );
    const assessmentEvents = events.filter((e) =>
      e.eventType === 'SYMPTOM_ASSESSMENT' ||
      e.eventType === 'SYMPTOM_CHECK' ||
      e.eventType === 'MED_ADHERENCE' ||
      e.eventType === 'RISK_ASSESSMENT'
    );
    const escalationEvents = events.filter((e) => e.requiresEscalation);

    // Get overall outcome from the last assessment
    const lastAssessment = assessmentEvents[assessmentEvents.length - 1];
    const outcome = lastAssessment?.eventData?.outcome || call?.outcome;

    return (
      <Box>
        {/* Overall Status Card */}
        {outcome && (
          <Card sx={{ mb: 3, bgcolor: `${getOutcomeConfig(outcome).color}.50` }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                {getOutcomeConfig(outcome).icon}
                <Typography variant="h6">{getOutcomeConfig(outcome).label}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {getOutcomeConfig(outcome).description}
              </Typography>
              {escalationEvents.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
                  First detected: {new Date(escalationEvents[0].createdAt).toLocaleString()}
                </Typography>
              )}
            </CardContent>
          </Card>
        )}

        <Grid container spacing={2}>
          {/* Symptoms Reported */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom color="primary">
                  Symptoms Reported
                </Typography>
                {symptomEvents.length > 0 ? (
                  <List dense>
                    {(() => {
                      type SymptomItem = { name: string; severity?: string; key: string };
                      const items: SymptomItem[] = [];
                      const seen = new Set<string>();

                      symptomEvents.forEach((event, eIdx) => {
                        if (event.eventType === 'SYMPTOM_CHECK') {
                          // Reaper format: symptoms is an array of strings
                          const syms: string[] = Array.isArray(event.eventData?.symptoms)
                            ? event.eventData.symptoms
                            : [];
                          const severity = event.eventData?.severity;
                          syms.forEach((name: string, i: number) => {
                            const dk = name.toLowerCase();
                            if (!seen.has(dk)) {
                              seen.add(dk);
                              items.push({ name, severity, key: `sc-${eIdx}-${i}` });
                            }
                          });
                        } else {
                          // Voice-agent format: single symptomName per event
                          const name = event.eventData?.symptomName || 'Unknown symptom';
                          const dk = (event.eventData?.symptomId || name).toLowerCase();
                          if (!seen.has(dk)) {
                            seen.add(dk);
                            items.push({ name, severity: event.eventData?.severity, key: `sr-${eIdx}` });
                          }
                        }
                      });

                      return items.length > 0 ? items.map((item) => (
                        <ListItem key={item.key} sx={{ px: 0 }}>
                          <ListItemText
                            primary={
                              <Typography variant="body2" fontWeight="medium">
                                {item.name}
                              </Typography>
                            }
                            secondary={
                              item.severity ? (
                                <Box sx={{ mt: 0.5 }}>
                                  <Chip
                                    label={`Severity: ${item.severity}`}
                                    size="small"
                                    color={getRiskColor(item.severity)}
                                  />
                                </Box>
                              ) : undefined
                            }
                          />
                        </ListItem>
                      )) : (
                        <Typography variant="body2" color="text.secondary">
                          No symptoms reported
                        </Typography>
                      );
                    })()}
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No symptoms reported
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Assessment Summary */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" gutterBottom color="primary">
                  Assessment Summary
                </Typography>
                {assessmentEvents.length > 0 ? (
                  <Box>
                    {(() => {
                      // Group by a stable key; keep only the latest per key.
                      // Voice-agent events key by symptomId/symptomName.
                      // Reaper events (SYMPTOM_CHECK, MED_ADHERENCE) fall back to eventType.
                      const eventMap = new Map<string, any>();
                      assessmentEvents.forEach((event, idx) => {
                        const key =
                          event.eventData?.symptomId ||
                          event.eventData?.symptomName ||
                          `${event.eventType}_${idx}`;
                        if (
                          !eventMap.has(key) ||
                          new Date(event.createdAt) > new Date(eventMap.get(key).createdAt)
                        ) {
                          eventMap.set(key, event);
                        }
                      });

                      const uniqueAssessments = Array.from(eventMap.values());

                      return uniqueAssessments.map((event, idx) => {
                        // Derive a human-readable title per event type
                        let title: string;
                        if (event.eventType === 'MED_ADHERENCE') {
                          title = 'Medication Adherence';
                        } else if (event.eventType === 'SYMPTOM_CHECK') {
                          const syms: string[] = Array.isArray(event.eventData?.symptoms)
                            ? event.eventData.symptoms
                            : [];
                          title = syms.length > 0 ? syms.join(', ') : 'Symptom Check';
                        } else {
                          title = event.eventData?.symptomName || 'Assessment';
                        }

                        return (
                          <Box key={idx} sx={{ mb: idx < uniqueAssessments.length - 1 ? 2 : 0 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {title}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                              {event.eventData?.outcome && (
                                <Chip
                                  label={event.eventData.outcome}
                                  size="small"
                                  color={getOutcomeConfig(event.eventData.outcome).color}
                                />
                              )}
                              {/* Severity chip for SYMPTOM_CHECK events */}
                              {event.eventType === 'SYMPTOM_CHECK' && event.eventData?.severity && (
                                <Chip
                                  label={`Severity: ${event.eventData.severity}`}
                                  size="small"
                                  color={getRiskColor(event.eventData.severity)}
                                />
                              )}
                              {/* Adherence chip for MED_ADHERENCE events */}
                              {event.eventType === 'MED_ADHERENCE' && (
                                <Chip
                                  label={
                                    event.eventData?.adherent
                                      ? 'Adherent'
                                      : `Missed: ${event.eventData?.missedDoses ?? 0} dose(s)`
                                  }
                                  size="small"
                                  color={event.eventData?.adherent ? 'success' : 'warning'}
                                />
                              )}
                              {event.eventData?.riskScore !== undefined && (
                                <Chip
                                  label={`Risk Score: ${event.eventData.riskScore}`}
                                  size="small"
                                  variant="outlined"
                                  color={
                                    event.eventData.riskScore >= 3 ? 'error' :
                                    event.eventData.riskScore >= 2 ? 'warning' :
                                    event.eventData.riskScore >= 1 ? 'info' : 'success'
                                  }
                                />
                              )}
                              {event.riskScore && (
                                <Chip
                                  label={event.riskScore}
                                  size="small"
                                  variant="outlined"
                                  color={getRiskColor(event.riskScore)}
                                />
                              )}
                            </Box>
                            {event.eventData?.reasoning && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                {event.eventData.reasoning}
                              </Typography>
                            )}
                            {event.eventData?.questionsAsked !== undefined && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                                Questions asked: {event.eventData.questionsAsked}
                              </Typography>
                            )}
                          </Box>
                        );
                      });
                    })()}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No assessments completed
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Patient Recovery Context */}
          {call?.patient?.condition && (
            <Grid item xs={12}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom color="primary">
                    Patient Recovery Context
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {/* Condition + Classification */}
                    <Box>
                      <Typography variant="caption" color="text.secondary">Condition</Typography>
                      <Typography variant="body2" fontWeight="medium">
                        {call.patient.condition}
                        {call.patient.classification && (
                          <> &mdash; {call.patient.classification}</>
                        )}
                      </Typography>
                    </Box>

                    {/* Recovery Phase + Day */}
                    {(() => {
                      const ph = resolvePhase(call);
                      if (!ph) return null;
                      return (
                        <>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Recovery Phase</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                              <Chip label={ph.label} size="small" color={phaseColorFromDays(ph.days)} />
                              <Typography variant="body2" color="text.secondary">Day {ph.days}</Typography>
                            </Box>
                          </Box>
                          {call.patient.conditionStartDate && (
                            <Box>
                              <Typography variant="caption" color="text.secondary">Surgery / Condition Start</Typography>
                              <Typography variant="body2" fontWeight="medium">
                                {new Date(call.patient!.conditionStartDate!).toLocaleDateString('en-US', {
                                  year: 'numeric', month: 'short', day: 'numeric',
                                })}
                              </Typography>
                            </Box>
                          )}
                        </>
                      );
                    })()}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}
        </Grid>
      </Box>
    );
  };

  if (!call) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">Call Details</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Call Summary */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Call Summary
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Chip label={`Channel: ${getChannelLabel(call.callPurpose)}`} size="small" />
            <Chip label={`Locale: ${call.locale}`} size="small" />
            <Chip label={`Outcome: ${call.outcome || 'IN PROGRESS'}`} size="small" />
            {call.durationSeconds && (
              <Chip
                label={`Duration: ${call.durationSeconds >= 3600
                  ? `${Math.floor(call.durationSeconds / 3600)}h ${Math.floor((call.durationSeconds % 3600) / 60)}m`
                  : `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s`}`}
                size="small"
              />
            )}
          </Box>
          {call.messageSessionId && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <Typography variant="caption" color="text.secondary">Session ID:</Typography>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', color: 'text.primary' }}
                title={call.messageSessionId}
              >
                {call.messageSessionId}
              </Typography>
              <Tooltip title="Copy session ID">
                <IconButton size="small" onClick={() => navigator.clipboard.writeText(call.messageSessionId!)}>
                  <ContentCopyIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
          {call.patient && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                Patient: {call.patient.name} ({call.patient.phoneNumber})
              </Typography>
              {call.patient.condition && (
                <Typography variant="body2" color="text.secondary">
                  Condition: {call.patient.condition}
                  {call.patient.classification && (
                    <> &mdash; <strong>{call.patient.classification}</strong></>
                  )}
                </Typography>
              )}
              {(() => {
                const ph = resolvePhase(call);
                if (!ph) return null;
                return (
                  <Typography variant="body2" color="text.secondary">
                    Recovery Phase: {ph.label} (Day {ph.days} at time of call)
                  </Typography>
                );
              })()}
            </Box>
          )}
        </Box>

        {/* Patient Feedback */}
        {call.feedbackText && (
          <Box sx={{ mt: 2, mb: 1 }}>
            <Card variant="outlined" sx={{ borderColor: 'warning.main' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                  <FeedbackIcon fontSize="small" color="warning" />
                  <Typography variant="subtitle2" color="warning.dark">
                    Patient Feedback
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.primary" sx={{ fontStyle: 'italic' }}>
                  "{call.feedbackText}"
                </Typography>
              </CardContent>
            </Card>
          </Box>
        )}

        <Divider />

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mt: 2 }}>
          <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
            <Tab label="Transcript" />
            <Tab label="Clinical Events" />
            <Tab label="Recording" />
          </Tabs>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <TabPanel value={tabValue} index={0}>
              <TranscriptViewer transcripts={transcripts} />
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
              {renderClinicalOverview()}
            </TabPanel>

            <TabPanel value={tabValue} index={2}>
              {call.recordingUrl ? (
                <Box>
                  <audio controls style={{ width: '100%' }}>
                    <source src={call.recordingUrl} type="audio/mpeg" />
                    Your browser does not support the audio element.
                  </audio>
                </Box>
              ) : (
                <Alert severity="info">No recording available for this call</Alert>
              )}
            </TabPanel>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
