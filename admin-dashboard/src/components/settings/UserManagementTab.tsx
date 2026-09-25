import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
  FormControl, IconButton, InputLabel, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { usersApi, AdminUser, UserRole } from '../../services/usersApi';
import { useAuth } from '../../context/AuthContext';

export default function UserManagementTab() {
  const { email: currentEmail } = useAuth();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add-user form state
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);

  // Delete state
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null); // stores email for display only
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    usersApi.list()
      .then(setUsers)
      .catch((err: unknown) => {
        const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Failed to load users');
        setLoadError(msg);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    setAddError(null);
    setAddSuccess(false);
    if (!newEmail.trim() || !newPassword.trim()) {
      setAddError('Email and password are required.'); return;
    }
    setAdding(true);
    try {
      await usersApi.create({ email: newEmail.trim(), password: newPassword.trim(), role: newRole });
      setAddSuccess(true);
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      load();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Failed to add user');
      setAddError(msg);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    setDeleteError(null);
    setDeletingEmail(user.email);
    try {
      await usersApi.remove(user.id);
      load();
    } catch (err: unknown) {
      const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Failed to remove user');
      setDeleteError(msg);
    } finally {
      setDeletingEmail(null);
    }
  };

  return (
    <Box>
      {/* Add user form */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>Add New User</Typography>

          {addError && <Alert severity="error" sx={{ mb: 2 }}>{addError}</Alert>}
          {addSuccess && <Alert severity="success" sx={{ mb: 2 }}>User added successfully.</Alert>}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
            <TextField
              label="Email *"
              value={newEmail}
              onChange={e => { setNewEmail(e.target.value); setAddSuccess(false); }}
              size="small"
              sx={{ flex: 2 }}
            />
            <TextField
              label="Password *"
              type="password"
              value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setAddSuccess(false); }}
              size="small"
              sx={{ flex: 2 }}
            />
            <FormControl size="small" sx={{ flex: 1, minWidth: 110 }}>
              <InputLabel>Role</InputLabel>
              <Select
                value={newRole}
                label="Role"
                onChange={e => setNewRole(e.target.value as UserRole)}
              >
                <MenuItem value="user">User</MenuItem>
                <MenuItem value="admin">Admin</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              onClick={handleAdd}
              disabled={adding}
              sx={{ whiteSpace: 'nowrap', mt: { xs: 0, sm: '2px' } }}
            >
              {adding ? <CircularProgress size={18} /> : 'Add User'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {/* User list */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>Existing Users</Typography>

          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}

          {loading ? (
            <Box display="flex" justifyContent="center" py={3}><CircularProgress /></Box>
          ) : loadError ? (
            <Alert severity="error">{loadError}</Alert>
          ) : users.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No users found.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell><strong>Email</strong></TableCell>
                  <TableCell><strong>Role</strong></TableCell>
                  <TableCell align="right"></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={u.role}
                        size="small"
                        color={u.role === 'admin' ? 'primary' : 'default'}
                        variant={u.role === 'admin' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {u.email !== currentEmail && (
                        <IconButton
                          size="small"
                          color="error"
                          disabled={deletingEmail === u.email}
                          onClick={() => handleDelete(u)}
                          title={`Remove ${u.email}`}
                        >
                          {deletingEmail === u.email
                            ? <CircularProgress size={16} />
                            : <DeleteIcon fontSize="small" />}
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
