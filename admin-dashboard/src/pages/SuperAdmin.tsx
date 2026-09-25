import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Switch,
  FormControlLabel,
  Autocomplete,
  Divider,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { usersApi, AdminUser, UserRole } from '../services/usersApi';
import { tenantsApi, skillsApi, capabilitiesApi, Tenant, SkillDefinition, CapabilityDefinition } from '../services/tenantsApi';
import { languagePacksApi, LanguagePack } from '../services/languagePacksApi';
import { useAuth } from '../context/AuthContext';

// ─── Tab panel helper ─────────────────────────────────────────────────────────
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

// ─── Users tab ────────────────────────────────────────────────────────────────
function UsersTab() {
  const { email: currentEmail } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [availableConditions, setAvailableConditions] = useState<string[]>([]);
  const [conditionInput, setConditionInput] = useState('');

  const [form, setForm] = useState({
    email: '',
    fullName: '',
    password: '',
    role: 'admin' as UserRole,
    isActive: true,
    conditions: [] as string[],
  });

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setUsers(await usersApi.list());
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const loadAvailableConditions = useCallback(() => {
    usersApi.listAvailableConditions()
      .then((keys) => setAvailableConditions(keys))
      .catch(() => setAvailableConditions([]));
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    setConditionInput('');
    setForm({ email: '', fullName: '', password: '', role: 'admin', isActive: true, conditions: [] });
    loadAvailableConditions();
    setDialogOpen(true);
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    setConditionInput('');
    setForm({
      email: user.email,
      fullName: user.fullName ?? '',
      password: '',
      role: user.role,
      isActive: user.isActive,
      conditions: user.conditions ?? [],
    });
    loadAvailableConditions();
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      if (editingUser) {
        const updates: Parameters<typeof usersApi.update>[1] = {};
        if (form.password) updates.password = form.password;
        if (form.role !== editingUser.role) updates.role = form.role;
        if ((form.fullName || null) !== editingUser.fullName) updates.fullName = form.fullName || undefined;
        if (form.isActive !== editingUser.isActive) updates.isActive = form.isActive;
        if (Object.values(updates).some(v => v !== undefined)) {
          await usersApi.update(editingUser.id, updates);
        }
        if (form.role === 'reviewer') {
          await usersApi.updateConditions(editingUser.email, form.conditions);
        }
        setSuccess(`User ${editingUser.email} updated.`);
      } else {
        if (!form.email || !form.password) {
          setError('Email and password are required.');
          return;
        }
        const created = await usersApi.create({ email: form.email, password: form.password, role: form.role, fullName: form.fullName || undefined });
        if (form.role === 'reviewer' && form.conditions.length > 0) {
          await usersApi.updateConditions(created.email, form.conditions);
        }
        setSuccess(`User ${form.email} created.`);
      }
      setDialogOpen(false);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) return;
    try {
      await usersApi.remove(userToDelete.id);
      setSuccess(`User ${userToDelete.email} deleted.`);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
      fetchUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
      setDeleteDialogOpen(false);
    }
  };

  const roleColor = (role: UserRole) =>
    role === 'super_admin' ? 'error' : role === 'admin' ? 'warning' : role === 'reviewer' ? 'info' : 'default';

  return (
    <Box>
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
        <Tooltip title="Refresh"><IconButton onClick={fetchUsers}><RefreshIcon /></IconButton></Tooltip>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New User</Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Email</strong></TableCell>
                <TableCell><strong>Full Name</strong></TableCell>
                <TableCell><strong>Role</strong></TableCell>
                <TableCell><strong>Conditions</strong></TableCell>
                <TableCell><strong>Active</strong></TableCell>
                <TableCell><strong>Last Login</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.fullName ?? '—'}</TableCell>
                  <TableCell>
                    <Chip label={u.role} size="small" color={roleColor(u.role) as any} />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {u.role === 'reviewer' && u.conditions && u.conditions.length > 0
                      ? u.conditions.join(', ')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip label={u.isActive ? 'Active' : 'Inactive'} size="small" color={u.isActive ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(u)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    {u.email !== currentEmail && (
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => { setUserToDelete(u); setDeleteDialogOpen(true); }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingUser ? `Edit — ${editingUser.email}` : 'New User'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {!editingUser && (
              <TextField
                label="Email" required fullWidth
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            )}
            <TextField
              label="Full Name" fullWidth
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <TextField
              label={editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
              type="password" fullWidth required={!editingUser}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <FormControl fullWidth>
              <InputLabel>Role</InputLabel>
              <Select
                value={form.role}
                label="Role"
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              >
                <MenuItem value="user">user</MenuItem>
                <MenuItem value="reviewer">reviewer</MenuItem>
                <MenuItem value="admin">admin</MenuItem>
                <MenuItem value="super_admin">super_admin</MenuItem>
              </Select>
            </FormControl>
            {form.role === 'reviewer' && (
              <Autocomplete
                multiple
                disableCloseOnSelect
                options={availableConditions}
                value={form.conditions}
                inputValue={conditionInput}
                onInputChange={(_e, val, reason) => {
                  if (reason !== 'reset') setConditionInput(val);
                }}
                onChange={(_e, value) => {
                  setForm({ ...form, conditions: value });
                  setConditionInput('');
                }}
                isOptionEqualToValue={(option, val) => option === val}
                filterSelectedOptions={false}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip label={option} size="small" {...getTagProps({ index })} />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Assigned Conditions"
                    placeholder={form.conditions.length === 0 ? 'Select conditions…' : ''}
                    helperText="Conditions the reviewer can access in the reviewer portal"
                  />
                )}
                noOptionsText="No generated conditions found"
              />
            )}
            {editingUser && (
              <FormControlLabel
                control={<Switch checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />}
                label="Active"
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : editingUser ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete <strong>{userToDelete?.email}</strong>?</Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── Tenants tab ──────────────────────────────────────────────────────────────
function TenantsTab() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    status: 'ACTIVE',
    enabledSkills: [] as string[],
    enabledCapabilities: [] as string[],
    welcomeMessage: '',
    languageOptions: [] as string[],
  });

  const [availableSkills, setAvailableSkills] = useState<SkillDefinition[]>([]);
  useEffect(() => {
    skillsApi.list().then(setAvailableSkills).catch(() => {});
  }, []);

  const [availableCapabilities, setAvailableCapabilities] = useState<CapabilityDefinition[]>([]);
  useEffect(() => {
    capabilitiesApi.list().then(setAvailableCapabilities).catch(() => {});
  }, []);

  const [activeLocaleCodes, setActiveLocaleCodes] = useState<string[]>([]);
  useEffect(() => {
    languagePacksApi.list()
      .then((packs) => setActiveLocaleCodes(packs.filter((p) => p.isActive).map((p) => p.localeCode)))
      .catch(() => {});
  }, []);

  const fetchTenants = useCallback(async () => {
    try {
      setLoading(true);
      setTenants(await tenantsApi.list());
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  const openCreate = () => {
    setEditingTenant(null);
    setForm({ name: '', slug: '', status: 'ACTIVE', enabledSkills: availableSkills.map((s) => s.name), enabledCapabilities: [], welcomeMessage: '', languageOptions: [] });
    setDialogOpen(true);
  };

  const openEdit = (t: Tenant) => {
    setEditingTenant(t);
    const features = t.settings?.features;
    const enabledSkills = features?.enabledSkills ?? availableSkills.map((s) => s.name);
    setForm({
      name: t.name,
      slug: t.slug,
      status: t.status,
      enabledSkills,
      enabledCapabilities: features?.enabledCapabilities ?? [],
      welcomeMessage: features?.welcomeMessage ?? '',
      languageOptions: features?.languageOptions ?? [],
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      if (editingTenant) {
        if (form.enabledSkills.length === 0 && form.enabledCapabilities.length === 0) {
          setError('At least one skill or capability must be enabled.');
          return;
        }
        await tenantsApi.update(editingTenant.id, {
          name: form.name || undefined,
          slug: form.slug || undefined,
          status: form.status || undefined,
          settings: {
            // Preserve any non-feature settings (e.g. whatsappSessionTimeoutMinutes)
            // the PUT does a full replace of `settings`.
            ...(editingTenant.settings ?? {}),
            features: {
              enabledSkills: form.enabledSkills,
              enabledCapabilities: form.enabledCapabilities,
              welcomeMessage: !form.enabledSkills.includes('symptom_check') && form.welcomeMessage
                ? form.welcomeMessage
                : null,
              languageOptions: form.enabledCapabilities.includes('language_selection')
                ? form.languageOptions
                : [],
            },
          },
        });
        setSuccess(`Tenant "${form.name}" updated.`);
      } else {
        if (!form.name || !form.slug) {
          setError('Name and slug are required.');
          return;
        }
        await tenantsApi.create(form.name, form.slug);
        setSuccess(`Tenant "${form.name}" created.`);
      }
      setDialogOpen(false);
      fetchTenants();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const statusColor = (s: string) =>
    s === 'ACTIVE' ? 'success' : s === 'INACTIVE' ? 'error' : 'default';

  return (
    <Box>
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
        <Tooltip title="Refresh"><IconButton onClick={fetchTenants}><RefreshIcon /></IconButton></Tooltip>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Tenant</Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell><strong>Slug</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                <TableCell><strong>ID</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>{t.name}</TableCell>
                  <TableCell><code>{t.slug}</code></TableCell>
                  <TableCell>
                    <Chip label={t.status} size="small" color={statusColor(t.status) as any} />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{t.id}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(t)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingTenant ? `Edit — ${editingTenant.name}` : 'New Tenant'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Tenant Name" required fullWidth
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Apollo Hospitals"
            />
            <TextField
              label="Slug" required fullWidth
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
              placeholder="e.g., apollo-hospitals"
              helperText="Used in API URLs — lowercase, hyphens only. Cannot be changed easily after patients are enrolled."
            />
            {editingTenant && (
              <>
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={form.status}
                    label="Status"
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    <MenuItem value="ACTIVE">ACTIVE</MenuItem>
                    <MenuItem value="INACTIVE">INACTIVE</MenuItem>
                  </Select>
                </FormControl>
                <Divider />
                <Typography variant="subtitle2" color="text.secondary">Features</Typography>
                {availableSkills.map((skill) => (
                  <FormControlLabel
                    key={skill.name}
                    control={
                      <Switch
                        checked={form.enabledSkills.includes(skill.name)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...form.enabledSkills, skill.name]
                            : form.enabledSkills.filter((s) => s !== skill.name);
                          setForm({ ...form, enabledSkills: next });
                        }}
                      />
                    }
                    label={skill.label}
                  />
                ))}
                {!form.enabledSkills.includes('symptom_check') && (
                  <TextField
                    label="Welcome Message"
                    fullWidth
                    multiline
                    rows={2}
                    value={form.welcomeMessage}
                    onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
                    helperText="Sent automatically on the patient's first message (FAQ-only mode)."
                    placeholder="e.g., Hello! I'm your post-surgery support assistant. How can I help you today?"
                  />
                )}
                {availableCapabilities.length > 0 && (
                  <>
                    <Divider />
                    <Typography variant="subtitle2" color="text.secondary">Capabilities</Typography>
                    {availableCapabilities.map((cap) => (
                      <FormControlLabel
                        key={cap.name}
                        control={
                          <Switch
                            checked={form.enabledCapabilities.includes(cap.name)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...form.enabledCapabilities, cap.name]
                                : form.enabledCapabilities.filter((c) => c !== cap.name);
                              setForm({ ...form, enabledCapabilities: next });
                            }}
                          />
                        }
                        label={cap.label}
                      />
                    ))}
                    {form.enabledCapabilities.includes('language_selection') && (
                      <Autocomplete
                        multiple
                        options={activeLocaleCodes}
                        value={form.languageOptions}
                        onChange={(_e, next) => setForm({ ...form, languageOptions: next })}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Language options"
                            helperText="Locales offered in the “set my language” flow. Leave empty to offer all active language packs."
                          />
                        )}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : editingTenant ? 'Save Changes' : 'Create Tenant'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── Language Packs tab ───────────────────────────────────────────────────────
const EMPTY_PACK = {
  localeCode: '',
  displayName: '',
  voiceProfile: '',
  isActive: true,
  scripts: '{\n  "greeting": "",\n  "consent_request": "",\n  "post_surgery_intro": "",\n  "goodbye": ""\n}',
  medicalLexicon: '{\n  "pain": "",\n  "doctor": "",\n  "medicine": "",\n  "hospital": ""\n}',
  sttHints: '',
};

function LanguagePacksTab() {
  const [packs, setPacks] = useState<LanguagePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<LanguagePack | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [packToDelete, setPackToDelete] = useState<LanguagePack | null>(null);
  const [saving, setSaving] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<{ scripts?: string; medicalLexicon?: string }>({});

  const [form, setForm] = useState(EMPTY_PACK);

  const fetchPacks = useCallback(async () => {
    try {
      setLoading(true);
      setPacks(await languagePacksApi.list());
      setError(null);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPacks(); }, [fetchPacks]);

  const openCreate = () => {
    setEditingPack(null);
    setForm(EMPTY_PACK);
    setJsonErrors({});
    setDialogOpen(true);
  };

  const openEdit = (p: LanguagePack) => {
    setEditingPack(p);
    setForm({
      localeCode: p.localeCode,
      displayName: p.displayName,
      voiceProfile: p.voiceProfile ?? '',
      isActive: p.isActive,
      scripts: JSON.stringify(p.scripts, null, 2),
      medicalLexicon: JSON.stringify(p.medicalLexicon, null, 2),
      sttHints: p.sttHints.join(', '),
    });
    setJsonErrors({});
    setDialogOpen(true);
  };

  const validateJson = (): boolean => {
    const errs: { scripts?: string; medicalLexicon?: string } = {};
    try { JSON.parse(form.scripts); } catch { errs.scripts = 'Invalid JSON'; }
    try { JSON.parse(form.medicalLexicon); } catch { errs.medicalLexicon = 'Invalid JSON'; }
    setJsonErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validateJson()) return;
    try {
      setSaving(true);
      setError(null);
      const payload = {
        displayName: form.displayName,
        voiceProfile: form.voiceProfile || null,
        isActive: form.isActive,
        scripts: JSON.parse(form.scripts),
        medicalLexicon: JSON.parse(form.medicalLexicon),
        sttHints: form.sttHints.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (editingPack) {
        await languagePacksApi.update(editingPack.localeCode, payload);
        setSuccess(`Language pack "${editingPack.localeCode}" updated.`);
      } else {
        if (!form.localeCode) { setError('Locale code is required.'); return; }
        await languagePacksApi.create({ localeCode: form.localeCode, ...payload });
        setSuccess(`Language pack "${form.localeCode}" created.`);
      }
      setDialogOpen(false);
      fetchPacks();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!packToDelete) return;
    try {
      await languagePacksApi.remove(packToDelete.localeCode);
      setSuccess(`Language pack "${packToDelete.localeCode}" deleted.`);
      setDeleteDialogOpen(false);
      setPackToDelete(null);
      fetchPacks();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <Box>
      {error   && <Alert severity="error"   sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
        <Tooltip title="Refresh"><IconButton onClick={fetchPacks}><RefreshIcon /></IconButton></Tooltip>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>New Language Pack</Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Locale Code</strong></TableCell>
                <TableCell><strong>Display Name</strong></TableCell>
                <TableCell><strong>Voice Profile</strong></TableCell>
                <TableCell><strong>STT Hints</strong></TableCell>
                <TableCell><strong>Active</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {packs.map((p) => (
                <TableRow key={p.localeCode} hover>
                  <TableCell><code>{p.localeCode}</code></TableCell>
                  <TableCell>{p.displayName}</TableCell>
                  <TableCell>{p.voiceProfile ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {p.sttHints.slice(0, 4).join(', ')}{p.sttHints.length > 4 ? ` +${p.sttHints.length - 4}` : ''}
                  </TableCell>
                  <TableCell>
                    <Chip label={p.isActive ? 'Active' : 'Inactive'} size="small" color={p.isActive ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => { setPackToDelete(p); setDeleteDialogOpen(true); }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingPack ? `Edit — ${editingPack.localeCode}` : 'New Language Pack'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {!editingPack && (
              <TextField
                label="Locale Code" required fullWidth
                value={form.localeCode}
                onChange={(e) => setForm({ ...form, localeCode: e.target.value })}
                placeholder="e.g., hi-IN, te-IN, en-IN"
              />
            )}
            <TextField
              label="Display Name" required fullWidth
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="e.g., Hindi (India)"
            />
            <TextField
              label="Voice Profile" fullWidth
              value={form.voiceProfile}
              onChange={(e) => setForm({ ...form, voiceProfile: e.target.value })}
              placeholder="e.g., hi-IN-female"
            />
            <TextField
              label="STT Hints (comma-separated)" fullWidth
              value={form.sttHints}
              onChange={(e) => setForm({ ...form, sttHints: e.target.value })}
              placeholder="e.g., दर्द, दवा, डॉक्टर"
              helperText="Words that help the speech-to-text engine recognise domain-specific terms"
            />
            <TextField
              label="Scripts (JSON)" required fullWidth multiline rows={6}
              value={form.scripts}
              onChange={(e) => setForm({ ...form, scripts: e.target.value })}
              error={!!jsonErrors.scripts}
              helperText={jsonErrors.scripts ?? 'Key-value pairs: script name → text in the target language'}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
            />
            <TextField
              label="Medical Lexicon (JSON)" required fullWidth multiline rows={5}
              value={form.medicalLexicon}
              onChange={(e) => setForm({ ...form, medicalLexicon: e.target.value })}
              error={!!jsonErrors.medicalLexicon}
              helperText={jsonErrors.medicalLexicon ?? 'Key-value pairs: English term → translated term'}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
            />
            <FormControlLabel
              control={<Switch checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />}
              label="Active"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : editingPack ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Language Pack</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete <strong>{packToDelete?.displayName}</strong> (<code>{packToDelete?.localeCode}</code>)?</Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>This will break any active conversations using this locale.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SuperAdmin() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Super Admin</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Users" />
        <Tab label="Tenants" />
        <Tab label="Language Packs" />
      </Tabs>
      <TabPanel value={tab} index={0}><UsersTab /></TabPanel>
      <TabPanel value={tab} index={1}><TenantsTab /></TabPanel>
      <TabPanel value={tab} index={2}><LanguagePacksTab /></TabPanel>
    </Box>
  );
}
