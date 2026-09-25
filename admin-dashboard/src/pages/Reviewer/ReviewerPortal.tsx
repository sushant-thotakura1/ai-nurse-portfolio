// admin-dashboard/src/pages/Reviewer/ReviewerPortal.tsx
import { useEffect, useState } from 'react';
import { Box, Typography, AppBar, Toolbar, Button } from '@mui/material';
import { useAuth } from '../../context/AuthContext';
import ConditionPanel from './ConditionPanel';
import ClassificationView from './ClassificationView';

interface Assignment { condition: string; classifications: string[]; }

export default function ReviewerPortal() {
  const { token, email, logout } = useAuth();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selected, setSelected] = useState<{ condition: string; classification: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/v1/api/reviewer/assignments', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then(({ assignments: a }: { assignments: Assignment[] }) => {
        setAssignments(a);
        if (a.length > 0 && a[0].classifications.length > 0) {
          setSelected({ condition: a[0].condition, classification: a[0].classifications[0] });
        }
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
      });
    return () => controller.abort();
  }, [token]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense">
          <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
            Clinical Review Portal
          </Typography>
          <Typography variant="caption" color="text.secondary" mr={2}>{email}</Typography>
          <Button size="small" onClick={logout}>Logout</Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ConditionPanel
          assignments={assignments}
          selected={selected}
          onSelect={(condition, classification) => setSelected({ condition, classification })}
        />
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {selected ? (
            <ClassificationView
              condition={selected.condition}
              classification={selected.classification}
              token={token!}
            />
          ) : (
            <Typography color="text.secondary">Select a condition to start reviewing.</Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
