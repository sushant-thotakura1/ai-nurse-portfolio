import { useState, FormEvent } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  Paper,
} from '@mui/material';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left panel — branding */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          width: '45%',
          bgcolor: '#1565c0',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          p: 6,
          color: 'white',
        }}
      >
        <Typography variant="h3" fontWeight={700} gutterBottom>
          AI Nurse
        </Typography>
        <Typography variant="h6" sx={{ opacity: 0.85, textAlign: 'center' }}>
          REAN Foundation — Voice Agent Admin Portal
        </Typography>
      </Box>

      {/* Right panel — login form */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#f5f5f5',
          p: 4,
        }}
      >
        <Paper elevation={3} sx={{ p: 5, width: '100%', maxWidth: 400, borderRadius: 2 }}>
          <Typography variant="h5" fontWeight={600} mb={1}>
            Sign In
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Enter your credentials to continue
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              required
              margin="normal"
              autoComplete="email"
              autoFocus
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
              margin="normal"
              autoComplete="current-password"
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading}
              sx={{ mt: 3, py: 1.5 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
            </Button>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
