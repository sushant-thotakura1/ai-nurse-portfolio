import {
  Box,
  Paper,
  Typography,
  Avatar,
  Chip,
} from '@mui/material';
import {
  Person as PersonIcon,
  SmartToy as BotIcon,
} from '@mui/icons-material';
import { Transcript } from '../services/callApi';

interface TranscriptViewerProps {
  transcripts: Transcript[];
}

export default function TranscriptViewer({ transcripts }: TranscriptViewerProps) {
  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (transcripts.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No transcript available
        </Typography>
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {transcripts.map((turn) => (
        <Paper
          key={turn.id}
          sx={{
            p: 2,
            display: 'flex',
            gap: 2,
            bgcolor: turn.speaker === 'agent' ? 'grey.50' : 'white',
          }}
        >
          <Avatar
            sx={{
              bgcolor: turn.speaker === 'agent' ? 'primary.main' : 'secondary.main',
            }}
          >
            {turn.speaker === 'agent' ? <BotIcon /> : <PersonIcon />}
          </Avatar>

          <Box sx={{ flex: 1 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 1,
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold">
                {turn.speaker === 'agent' ? 'AI Nurse' : 'Patient'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {turn.confidenceScore && (
                  <Chip
                    label={`${(turn.confidenceScore * 100).toFixed(0)}% conf.`}
                    size="small"
                    variant="outlined"
                  />
                )}
                <Typography variant="caption" color="text.secondary">
                  {formatTime(turn.timestamp)}
                </Typography>
              </Box>
            </Box>

            <Typography variant="body1" paragraph>
              {turn.originalText}
            </Typography>

            {turn.translatedText && turn.translatedText !== turn.originalText && (
              <Box sx={{ mt: 1, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Translation:
                </Typography>
                <Typography variant="body2">{turn.translatedText}</Typography>
              </Box>
            )}
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
