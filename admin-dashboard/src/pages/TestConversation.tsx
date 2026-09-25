/**
 * Test Conversation Page
 * Interface for testing AI nurse conversations with audio
 */

import React, { useState, useRef } from 'react';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  CircularProgress,
  Alert,
  Paper,
  IconButton,
  List,
  ListItem,
  Chip,
} from '@mui/material';
import {
  Mic as MicIcon,
  Stop as StopIcon,
  PlayArrow as PlayIcon,
  Send as SendIcon,
  CallEnd as CallEndIcon,
} from '@mui/icons-material';
import { api } from '../services/api';

interface Patient {
  id: string;
  phoneNumber: string;
  name: string;
  dob?: string;
  preferredLocale: string;
  condition?: string;
  conditionStartDate?: string;
}

interface HealthCondition {
  id: string;
  healthCondition: string;
  name: string;
  version: string;
}

interface ConversationTurn {
  speaker: 'agent' | 'patient';
  text: string;
  audioUrl?: string;
  timestamp: Date;
}

export default function TestConversation() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [healthConditions, setHealthConditions] = useState<HealthCondition[]>([]);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [selectedHealthCondition, setSelectedHealthCondition] = useState('');
  const [locale, setLocale] = useState('en-IN');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Load data on component mount
  React.useEffect(() => {
    fetchPatients();
    fetchHealthConditions();
  }, []);

  // Auto-derive locale from selected patient's preferredLocale
  React.useEffect(() => {
    const patient = patients.find((p) => p.id === selectedPatient);
    if (patient?.preferredLocale) {
      setLocale(patient.preferredLocale);
    }
  }, [selectedPatient, patients]);

  const fetchPatients = async () => {
    try {
      const response = await api.get('/patients');
      setPatients(response.data);
    } catch (error) {
      console.error('Failed to fetch patients:', error);
      setError('Failed to load patients');
    }
  };

  const fetchHealthConditions = async () => {
    try {
      const response = await api.get('/knowledge-graphs?status=ACTIVE');
      setHealthConditions(response.data);
    } catch (error) {
      console.error('Failed to fetch health conditions:', error);
      setError('Failed to load health conditions');
    }
  };

  const startConversation = async () => {
    if (!selectedPatient) {
      setError('Please select a patient');
      return;
    }

    try {
      setError(null);
      setIsProcessing(true);

      const response = await api.post('/test-conversation/start', {
        patientId: selectedPatient,
        callPurpose: 'HEALTH_CHECKUP', // backend will override based on patient's KG trigger type
        locale,
      });

      const data = response.data;
      setSessionId(data.sessionId);

      // Add greeting to conversation
      const audioUrl = `data:audio/wav;base64,${data.greeting.audioBase64}`;
      setConversation([
        {
          speaker: 'agent',
          text: data.greeting.text,
          audioUrl,
          timestamp: new Date(),
        },
      ]);

      // Auto-play greeting
      playAudio(audioUrl);
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        processRecording();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
    } catch (error: any) {
      setError('Failed to access microphone: ' + error.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
    }
  };

  const processRecording = async () => {
    try {
      setIsProcessing(true);

      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });

      // Create FormData
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');

      // Send to API — do not set Content-Type manually; Axios must auto-set it
      // with the correct multipart boundary, otherwise busboy throws "Unexpected end of form"
      const response = await api.post(`/test-conversation/${sessionId}/audio`, formData);

      const data = response.data;

      // Add patient message to conversation
      setConversation((prev) => [
        ...prev,
        {
          speaker: 'patient',
          text: data.patientTranscript,
          timestamp: new Date(),
        },
      ]);

      // Add agent response
      const audioUrl = `data:audio/wav;base64,${data.agentResponse.audioBase64}`;
      setConversation((prev) => [
        ...prev,
        {
          speaker: 'agent',
          text: data.agentResponse.text,
          audioUrl,
          timestamp: new Date(),
        },
      ]);

      // Auto-play agent response
      playAudio(audioUrl);
    } catch (error: any) {
      setError('Failed to process recording: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = (audioUrl: string) => {
    const audio = new Audio(audioUrl);
    audio.play();
  };

  const endConversation = async () => {
    if (!sessionId) return;

    try {
      setIsProcessing(true);

      await api.post(`/test-conversation/${sessionId}/end`);

      // Reset state
      setSessionId(null);
      setConversation([]);
      setSelectedPatient('');
    } catch (error: any) {
      setError('Failed to end conversation: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Test AI Nurse Conversation
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!sessionId ? (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Start New Test Conversation
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
              <FormControl fullWidth>
                <InputLabel>Select Patient</InputLabel>
                <Select
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                  label="Select Patient"
                >
                  {patients.map((patient) => {
                    const daysSince = patient.conditionStartDate
                      ? Math.floor(
                          (new Date().getTime() - new Date(patient.conditionStartDate).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : null;
                    let phase = '';
                    if (daysSince !== null) {
                      if (daysSince <= 7) phase = 'Phase I';
                      else if (daysSince <= 30) phase = 'Phase II';
                      else if (daysSince <= 90) phase = 'Phase III';
                      else phase = 'Post-Recovery';
                    }

                    // Calculate age if DOB is available
                    let age = '';
                    if (patient.dob) {
                      const birthDate = new Date(patient.dob);
                      const today = new Date();
                      const ageYears = today.getFullYear() - birthDate.getFullYear();
                      age = `, Age ${ageYears}`;
                    }

                    return (
                      <MenuItem key={patient.id} value={patient.id}>
                        <Box sx={{ py: 0.5 }}>
                          <Typography variant="body1" fontWeight="medium">
                            {patient.name} {age}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {patient.phoneNumber}
                            {patient.condition && ` • ${patient.condition}`}
                            {daysSince !== null && ` • ${phase} (Day ${daysSince})`}
                          </Typography>
                        </Box>
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>

              {selectedPatient && (() => {
                const patient = patients.find((p) => p.id === selectedPatient);
                if (!patient) return null;

                const daysSince = patient.conditionStartDate
                  ? Math.floor(
                      (new Date().getTime() - new Date(patient.conditionStartDate).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                  : null;

                let phase = '';
                if (daysSince !== null) {
                  if (daysSince <= 7) phase = 'Phase I';
                  else if (daysSince <= 30) phase = 'Phase II';
                  else if (daysSince <= 90) phase = 'Phase III';
                  else phase = 'Post-Recovery';
                }

                return (
                  <Box sx={{ p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
                    <Typography variant="body1" fontWeight="medium" color="info.dark" gutterBottom>
                      Patient Information
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      <Typography variant="body2" color="info.dark">
                        <strong>Name:</strong> {patient.name}
                      </Typography>
                      <Typography variant="body2" color="info.dark">
                        <strong>Phone:</strong> {patient.phoneNumber}
                      </Typography>
                      {patient.dob && (
                        <Typography variant="body2" color="info.dark">
                          <strong>Date of Birth:</strong>{' '}
                          {new Date(patient.dob).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </Typography>
                      )}
                      <Typography variant="body2" color="info.dark">
                        <strong>Language:</strong> {patient.preferredLocale}
                      </Typography>
                      {patient.condition && (
                        <Typography variant="body2" color="info.dark">
                          <strong>Health Condition:</strong> {patient.condition}
                        </Typography>
                      )}
                      {phase && (
                        <Typography variant="body2" color="info.dark">
                          <strong>Recovery Phase:</strong> {phase} (Day {daysSince})
                        </Typography>
                      )}
                      <Typography variant="body2" color="info.dark" sx={{ mt: 1 }}>
                        <strong>Call Purpose:</strong> Health Check-in (derived from condition)
                      </Typography>
                    </Box>
                  </Box>
                );
              })()}

              <Button
                variant="contained"
                size="large"
                onClick={startConversation}
                disabled={isProcessing || !selectedPatient}
                startIcon={isProcessing ? <CircularProgress size={20} /> : <SendIcon />}
              >
                {isProcessing ? 'Starting...' : 'Start Conversation'}
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Box>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="h6" gutterBottom>
                    Active Conversation
                    <Chip label={locale} size="small" sx={{ ml: 1 }} />
                  </Typography>
                  {(() => {
                    const patient = patients.find((p) => p.id === selectedPatient);
                    if (!patient) return null;

                    const daysSince = patient.conditionStartDate
                      ? Math.floor(
                          (new Date().getTime() - new Date(patient.conditionStartDate).getTime()) /
                            (1000 * 60 * 60 * 24)
                        )
                      : null;

                    let phase = '';
                    if (daysSince !== null) {
                      if (daysSince <= 7) phase = 'Phase I';
                      else if (daysSince <= 30) phase = 'Phase II';
                      else if (daysSince <= 90) phase = 'Phase III';
                      else phase = 'Post-Recovery';
                    }

                    return (
                      <Typography variant="body2" color="text.secondary">
                        {patient.name} • {patient.phoneNumber}
                        {phase && ` • ${phase} (Day ${daysSince})`}
                      </Typography>
                    );
                  })()}
                </Box>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={endConversation}
                  startIcon={<CallEndIcon />}
                  disabled={isProcessing}
                >
                  End Call
                </Button>
              </Box>
            </CardContent>
          </Card>

          <Paper sx={{ p: 2, mb: 2, maxHeight: 500, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              Conversation
            </Typography>
            <List>
              {conversation.map((turn, index) => (
                <ListItem
                  key={index}
                  sx={{
                    flexDirection: 'column',
                    alignItems: turn.speaker === 'agent' ? 'flex-start' : 'flex-end',
                    mb: 2,
                  }}
                >
                  <Box
                    sx={{
                      maxWidth: '70%',
                      bgcolor: turn.speaker === 'agent' ? 'primary.light' : 'grey.300',
                      color: turn.speaker === 'agent' ? 'white' : 'black',
                      borderRadius: 2,
                      p: 2,
                    }}
                  >
                    <Typography variant="caption" display="block" gutterBottom>
                      {turn.speaker === 'agent' ? 'AI Nurse' : 'Patient'}
                    </Typography>
                    <Typography variant="body1">{turn.text}</Typography>
                    {turn.audioUrl && (
                      <IconButton
                        size="small"
                        onClick={() => playAudio(turn.audioUrl!)}
                        sx={{ mt: 1, color: 'inherit' }}
                      >
                        <PlayIcon />
                      </IconButton>
                    )}
                  </Box>
                </ListItem>
              ))}
            </List>
          </Paper>

          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2 }}>
                {!isRecording ? (
                  <Button
                    variant="contained"
                    size="large"
                    color="primary"
                    onClick={startRecording}
                    disabled={isProcessing}
                    startIcon={<MicIcon />}
                    sx={{ px: 4, py: 2 }}
                  >
                    {isProcessing ? 'Processing...' : 'Hold to Speak'}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="large"
                    color="error"
                    onClick={stopRecording}
                    startIcon={<StopIcon />}
                    sx={{ px: 4, py: 2 }}
                  >
                    Stop Recording
                  </Button>
                )}
              </Box>
              <Typography variant="caption" display="block" textAlign="center" sx={{ mt: 1 }}>
                {isRecording
                  ? 'Recording... Click stop when done'
                  : isProcessing
                  ? 'Processing your audio...'
                  : 'Click to record your response'}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      )}
    </Container>
  );
}
