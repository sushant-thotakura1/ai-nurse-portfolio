import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  CircularProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Upload as UploadIcon,
  CheckCircle as ActiveIcon,
  Drafts as DraftIcon,
  Archive as ArchiveIcon,
  ExpandMore as ExpandMoreIcon,
  Visibility as ViewIcon,
  CheckCircleOutline as ActivateIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { api, KnowledgeGraphListItem } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function KnowledgeGraphs() {
  const { isAdmin } = useAuth();
  const [knowledgeGraphs, setKnowledgeGraphs] = useState<KnowledgeGraphListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedKG, setSelectedKG] = useState<KnowledgeGraphListItem | null>(null);
  const [kgData, setKgData] = useState<any | null>(null);
  const [version, setVersion] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [kgToDelete, setKgToDelete] = useState<KnowledgeGraphListItem | null>(null);
  const [conditionFilter, setConditionFilter] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);

  useEffect(() => {
    fetchKnowledgeGraphs(conditionFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditionFilter]);

  const fetchKnowledgeGraphs = async (condition?: string) => {
    try {
      setLoading(true);
      const response = await api.get('/knowledge-graphs', {
        params: condition ? { condition } : undefined,
      });
      setKnowledgeGraphs(response.data);
      // Only refresh the dropdown's option list from an unfiltered fetch --
      // a filtered response only contains the selected condition, which
      // would otherwise shrink the dropdown to whatever's currently chosen.
      if (!condition) {
        const distinct = Array.from(
          new Set(response.data.map((kg: KnowledgeGraphListItem) => kg.condition)),
        ) as string[];
        setConditions(distinct.sort());
      }
      setError(null);
    } catch (err: any) {
      setError('Failed to load knowledge graphs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleConditionFilterChange = (e: SelectChangeEvent) => {
    setConditionFilter(e.target.value);
  };

  const handleUpload = async () => {
    if (!file || !version.trim()) {
      setError('Please provide the version and select an XLSX file');
      return;
    }

    try {
      setUploading(true);
      setError(null);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('version', version.trim());

      const response = await api.post('/knowledge-graphs/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const result = response.data;

      if (!result.isValid) {
        setError(`Upload succeeded but validation failed: ${result.validationErrors?.length || 0} error(s) found`);
      } else {
        setSuccess('Knowledge graph uploaded successfully!');
        setUploadDialogOpen(false);
        setVersion('');
        setFile(null);
        fetchKnowledgeGraphs(conditionFilter);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await api.post(`/knowledge-graphs/${id}/activate`);
      setSuccess('Knowledge graph activated!');
      fetchKnowledgeGraphs(conditionFilter);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await api.post(`/knowledge-graphs/${id}/archive`);
      setSuccess('Knowledge graph archived!');
      fetchKnowledgeGraphs(conditionFilter);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async () => {
    if (!kgToDelete) return;
    try {
      await api.delete(`/knowledge-graphs/${kgToDelete.id}`);
      setSuccess('Knowledge graph deleted!');
      setDeleteDialogOpen(false);
      setKgToDelete(null);
      fetchKnowledgeGraphs(conditionFilter);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      setDeleteDialogOpen(false);
    }
  };

  const handleView = async (kg: KnowledgeGraphListItem) => {
    try {
      setSelectedKG(kg);
      const response = await api.get(`/knowledge-graphs/${kg.id}`);
      setKgData(response.data);
      setViewDialogOpen(true);
    } catch (err: any) {
      setError('Failed to load knowledge graph data');
    }
  };

  const statusColor = (s: string) =>
    s === 'ACTIVE' ? 'success' : s === 'DRAFT' ? 'warning' : 'default';

  const StatusIcon = ({ status }: { status: string }) =>
    status === 'ACTIVE' ? <ActiveIcon fontSize="small" /> :
    status === 'DRAFT'  ? <DraftIcon  fontSize="small" /> :
                          <ArchiveIcon fontSize="small" />;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Knowledge Graphs</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="condition-filter-label">Condition</InputLabel>
            <Select
              labelId="condition-filter-label"
              label="Condition"
              value={conditionFilter}
              onChange={handleConditionFilterChange}
            >
              <MenuItem value="">All Conditions</MenuItem>
              {conditions.map((c) => (
                <MenuItem key={c} value={c}>{c}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            startIcon={<UploadIcon />}
            onClick={() => setUploadDialogOpen(true)}
            disabled={!isAdmin}
          >
            Upload XLSX
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
          {knowledgeGraphs.map((kg) => (
            <Card key={kg.id}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 2 }}>
                  <Box>
                    <Typography variant="h6">{kg.condition}</Typography>
                    <Typography variant="body2" color="text.secondary">v{kg.version}</Typography>
                  </Box>
                  <Chip
                    icon={<StatusIcon status={kg.status} />}
                    label={kg.status}
                    color={statusColor(kg.status) as any}
                    size="small"
                  />
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    <strong>Classifications:</strong>{' '}
                    {kg.classifications.length > 0
                      ? kg.classifications.map((c) => <Chip key={c} label={c} size="small" sx={{ mr: 0.5 }} />)
                      : '—'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    <strong>Phases:</strong> {kg.phaseNames.join(', ') || '—'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    <strong>Valid:</strong> {kg.isValid ? '✓ Yes' : '✗ No'}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title="View Details">
                    <IconButton size="small" color="primary" onClick={() => handleView(kg)}>
                      <ViewIcon />
                    </IconButton>
                  </Tooltip>
                  {isAdmin && kg.isValid && (kg.status === 'DRAFT' || kg.status === 'ARCHIVED') && (
                    <Tooltip title="Activate">
                      <IconButton size="small" color="success" onClick={() => handleActivate(kg.id)}>
                        <ActivateIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  {isAdmin && (kg.status === 'DRAFT' || kg.status === 'ACTIVE') && (
                    <Tooltip title="Archive">
                      <IconButton size="small" color="warning" onClick={() => handleArchive(kg.id)}>
                        <ArchiveIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  {isAdmin && kg.status !== 'ACTIVE' && (
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => { setKgToDelete(kg); setDeleteDialogOpen(true); }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Upload Dialog — Version + File only */}
      <Dialog open={uploadDialogOpen} onClose={() => setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Knowledge Graph</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The Condition name and Classifications are derived automatically from the uploaded XLSX file.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Version"
              fullWidth
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g., v1.0"
              required
            />
            <Button variant="outlined" component="label">
              Select XLSX File
              <input
                type="file"
                hidden
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Button>
            {file && (
              <Typography variant="body2" color="text.secondary">Selected: {file.name}</Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setUploadDialogOpen(false); setVersion(''); setFile(null); }}>
            Cancel
          </Button>
          <Button onClick={handleUpload} variant="contained" disabled={uploading}>
            {uploading ? <CircularProgress size={24} /> : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Knowledge Graph</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{kgToDelete?.condition} v{kgToDelete?.version}</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onClose={() => setViewDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          {selectedKG?.condition}
          <Typography variant="body2" color="text.secondary">
            v{selectedKG?.version} · {selectedKG?.classifications.join(', ')}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {kgData && (
            <Box sx={{ mt: 2 }}>
              {/* Classifications & Phases */}
              {Object.entries((kgData.condition?.classifications ?? {})).map(([cls, clsDef]: [string, any]) => (
                <Accordion key={cls} defaultExpanded={Object.keys(kgData.condition?.classifications ?? {}).length === 1}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">Classification: {cls}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Phase</strong></TableCell>
                            <TableCell><strong>Day Range</strong></TableCell>
                            <TableCell><strong>Focus</strong></TableCell>
                            <TableCell><strong>Review</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.entries(clsDef.phases ?? {}).map(([phaseKey, phase]: [string, any]) => (
                            <TableRow key={phaseKey}>
                              <TableCell>{phaseKey}</TableCell>
                              <TableCell>
                                {phase.day_range_type === 'ongoing'
                                  ? 'ongoing'
                                  : phase.day_range[1] === null
                                  ? `${phase.day_range[0]}+`
                                  : `${phase.day_range[0]}–${phase.day_range[1]} days`}
                              </TableCell>
                              <TableCell>{phase.focus}</TableCell>
                              <TableCell>{phase.review}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              ))}

              {/* Symptoms */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Symptoms ({Object.keys(kgData.symptoms ?? {}).length})</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>ID</strong></TableCell>
                          <TableCell><strong>Name</strong></TableCell>
                          <TableCell><strong>Classifications</strong></TableCell>
                          <TableCell><strong>Phases</strong></TableCell>
                          <TableCell><strong>Severity</strong></TableCell>
                          <TableCell><strong>Questions</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Object.entries(kgData.symptoms ?? {}).map(([id, symptom]: [string, any]) => (
                          <TableRow key={id}>
                            <TableCell>{id}</TableCell>
                            <TableCell>{symptom.name}</TableCell>
                            <TableCell>{(symptom.applicable_classifications ?? []).join(', ')}</TableCell>
                            <TableCell>{(symptom.applicable_phases ?? []).join(', ')}</TableCell>
                            <TableCell>{symptom.base_severity}</TableCell>
                            <TableCell>{(symptom.assessment_questions ?? []).length}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>

              {/* Red Flags */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Red Flags ({(kgData.red_flags ?? []).length})</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>ID</strong></TableCell>
                          <TableCell><strong>Trigger</strong></TableCell>
                          <TableCell><strong>Classifications</strong></TableCell>
                          <TableCell><strong>Action</strong></TableCell>
                          <TableCell><strong>Urgency</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(kgData.red_flags ?? []).map((flag: any) => (
                          <TableRow key={flag.id}>
                            <TableCell>{flag.id}</TableCell>
                            <TableCell>{flag.trigger}</TableCell>
                            <TableCell>{(flag.applicable_classifications ?? []).join(', ')}</TableCell>
                            <TableCell>{flag.action}</TableCell>
                            <TableCell>
                              <Chip
                                label={flag.urgency}
                                size="small"
                                color={flag.urgency === 'immediate' ? 'error' : 'warning'}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>

              {/* Instructions */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">Instructions ({(kgData.instructions ?? []).length})</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell><strong>ID</strong></TableCell>
                          <TableCell><strong>Classifications</strong></TableCell>
                          <TableCell><strong>Phase</strong></TableCell>
                          <TableCell><strong>Category</strong></TableCell>
                          <TableCell><strong>Instruction</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(kgData.instructions ?? []).map((inst: any) => (
                          <TableRow key={inst.id}>
                            <TableCell>{inst.id}</TableCell>
                            <TableCell>{(inst.applicable_classifications ?? []).join(', ')}</TableCell>
                            <TableCell>{(inst.applicable_phases ?? []).join(', ')}</TableCell>
                            <TableCell><Chip label={inst.category} size="small" /></TableCell>
                            <TableCell>{inst.text}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>

              {/* Facts */}
              {kgData.facts && Object.keys(kgData.facts).length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">Facts ({Object.keys(kgData.facts).length})</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Name</strong></TableCell>
                            <TableCell><strong>Area</strong></TableCell>
                            <TableCell><strong>Type</strong></TableCell>
                            <TableCell><strong>Valid For</strong></TableCell>
                            <TableCell><strong>Required</strong></TableCell>
                            <TableCell><strong>Classifications</strong></TableCell>
                            <TableCell><strong>Phases</strong></TableCell>
                            <TableCell><strong>Extraction Hint</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.entries(kgData.facts).map(([machineName, fact]: [string, any]) => (
                            <TableRow key={machineName}>
                              <TableCell>
                                <code>{machineName}</code>
                                {fact.display_name && (
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    {fact.display_name}
                                  </Typography>
                                )}
                              </TableCell>
                              <TableCell>{fact.area}</TableCell>
                              <TableCell>{fact.type}{fact.unit ? ` (${fact.unit})` : ''}</TableCell>
                              <TableCell>{fact.valid_for}</TableCell>
                              <TableCell>
                                <Chip
                                  label={fact.required ? 'Required' : 'Optional'}
                                  size="small"
                                  color={fact.required ? 'primary' : 'default'}
                                />
                              </TableCell>
                              <TableCell>{(fact.applicable_classifications ?? []).join(', ')}</TableCell>
                              <TableCell>{(fact.applicable_phases ?? []).join(', ')}</TableCell>
                              <TableCell>{fact.extraction_hint ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Rules */}
              {kgData.rules && kgData.rules.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">Rules ({kgData.rules.length})</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Rule ID</strong></TableCell>
                            <TableCell><strong>Red Flag ID</strong></TableCell>
                            <TableCell><strong>Expression</strong></TableCell>
                            <TableCell><strong>Action</strong></TableCell>
                            <TableCell><strong>Patient Action</strong></TableCell>
                            <TableCell><strong>Classifications</strong></TableCell>
                            <TableCell><strong>Phases</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {kgData.rules.map((rule: any) => (
                            <TableRow key={rule.rule_id}>
                              <TableCell>{rule.rule_id}</TableCell>
                              <TableCell>{rule.red_flag_id}</TableCell>
                              <TableCell><code>{rule.expression}</code></TableCell>
                              <TableCell>
                                <Chip
                                  label={rule.action}
                                  size="small"
                                  color={rule.action === 'ESCALATE' ? 'error' : 'default'}
                                />
                              </TableCell>
                              <TableCell>{rule.patient_action ?? '—'}</TableCell>
                              <TableCell>{(rule.applicable_classifications ?? []).join(', ')}</TableCell>
                              <TableCell>{(rule.applicable_phases ?? []).join(', ')}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Settings */}
              {kgData.settings && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">Settings</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Setting</strong></TableCell>
                            <TableCell><strong>Value</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          <TableRow>
                            <TableCell>Max Questions per Check-in</TableCell>
                            <TableCell>{kgData.settings.max_questions_per_checkin}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Min Days Between Check-ins</TableCell>
                            <TableCell>{kgData.settings.min_days_between_checkins}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Check-in Trigger Stale Count</TableCell>
                            <TableCell>{kgData.settings.checkin_trigger_stale_count}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell>Time Uncertainty Tolerance</TableCell>
                            <TableCell>
                              {kgData.settings.time_uncertainty_tolerance != null
                                ? `${Math.round(kgData.settings.time_uncertainty_tolerance * 100)}%`
                                : '—'}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Warnings */}
              {kgData.warnings && kgData.warnings.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">Warnings ({kgData.warnings.length})</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {kgData.warnings.map((warning: string, idx: number) => (
                        <Alert key={idx} severity="warning">{warning}</Alert>
                      ))}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Rule Tests */}
              {kgData.rule_tests && kgData.rule_tests.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">Rule Tests ({kgData.rule_tests.length})</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Test ID</strong></TableCell>
                            <TableCell><strong>Rule ID</strong></TableCell>
                            <TableCell><strong>Scenario</strong></TableCell>
                            <TableCell><strong>Observations</strong></TableCell>
                            <TableCell><strong>Expect</strong></TableCell>
                            <TableCell><strong>Notes</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {kgData.rule_tests.map((test: any) => (
                            <TableRow key={test.test_id}>
                              <TableCell>{test.test_id}</TableCell>
                              <TableCell>{test.rule_id}</TableCell>
                              <TableCell>{test.scenario}</TableCell>
                              <TableCell>
                                {(test.observations ?? []).map((obs: any, idx: number) => (
                                  <Typography key={idx} variant="body2" component="div">
                                    {obs.fact} = {String(obs.value)} ({obs.offset_hours}h)
                                  </Typography>
                                ))}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={test.expect}
                                  size="small"
                                  color={test.expect === 'FIRES' ? 'success' : 'default'}
                                />
                              </TableCell>
                              <TableCell>{test.notes ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </AccordionDetails>
                </Accordion>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
