import { useState, useEffect } from 'react';
import { Box, Paper, Typography, CircularProgress, Alert } from '@mui/material';
import {
  People as PeopleIcon,
  Phone as PhoneIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { api } from '../services/api';

interface StatCard {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

interface CallSession {
  id: string;
  state: string;
  outcome?: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<StatCard[]>([
    {
      title: 'Total Patients',
      value: '...',
      icon: <PeopleIcon sx={{ fontSize: 40 }} />,
      color: '#1976d2',
    },
    {
      title: 'Total Calls',
      value: '...',
      icon: <PhoneIcon sx={{ fontSize: 40 }} />,
      color: '#2e7d32',
    },
    {
      title: 'Completed Calls',
      value: '...',
      icon: <CheckCircleIcon sx={{ fontSize: 40 }} />,
      color: '#ed6c02',
    },
    {
      title: 'Failed Calls',
      value: '...',
      icon: <ErrorIcon sx={{ fontSize: 40 }} />,
      color: '#d32f2f',
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch patients
      const patientsResponse = await api.get('/patients?limit=1000');
      const patients = patientsResponse.data;
      const totalPatients = patients.length;

      // Fetch call sessions
      const callsResponse = await api.get('/calls?limit=1000');
      const calls: CallSession[] = callsResponse.data;
      const totalCalls = calls.length;

      // Count completed and failed calls
      const completedCalls = calls.filter(
        (call) => call.state === 'COMPLETED' && call.outcome === 'COMPLETED'
      ).length;
      const failedCalls = calls.filter(
        (call) => call.state === 'FAILED' || call.outcome === 'FAILED'
      ).length;

      // Update stats
      setStats([
        {
          title: 'Total Patients',
          value: totalPatients.toString(),
          icon: <PeopleIcon sx={{ fontSize: 40 }} />,
          color: '#1976d2',
        },
        {
          title: 'Total Calls',
          value: totalCalls.toString(),
          icon: <PhoneIcon sx={{ fontSize: 40 }} />,
          color: '#2e7d32',
        },
        {
          title: 'Completed Calls',
          value: completedCalls.toString(),
          icon: <CheckCircleIcon sx={{ fontSize: 40 }} />,
          color: '#ed6c02',
        },
        {
          title: 'Failed Calls',
          value: failedCalls.toString(),
          icon: <ErrorIcon sx={{ fontSize: 40 }} />,
          color: '#d32f2f',
        },
      ]);
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError('Failed to load dashboard data. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        Overview of the AI Nurse Voice Agent system
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: 3,
            }}
          >
            {stats.map((stat) => (
              <Paper
                key={stat.title}
                sx={{
                  p: 3,
                  display: 'flex',
                  flexDirection: 'column',
                  height: 140,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <Box>
                    <Typography color="text.secondary" variant="body2" gutterBottom>
                      {stat.title}
                    </Typography>
                    <Typography variant="h4" component="div">
                      {stat.value}
                    </Typography>
                  </Box>
                  <Box sx={{ color: stat.color }}>{stat.icon}</Box>
                </Box>
              </Paper>
            ))}
          </Box>

          <Box sx={{ mt: 4 }}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Recent Activity
              </Typography>
              <Typography variant="body2" color="text.secondary">
                No recent activity to display
              </Typography>
            </Paper>
          </Box>
        </>
      )}
    </Box>
  );
}
