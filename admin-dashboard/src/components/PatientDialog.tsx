import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  CircularProgress,
  Checkbox,
  FormControlLabel,
  FormHelperText,
} from '@mui/material';
import { Patient, CreatePatientRequest, KnowledgeGraphListItem } from '../services/api';
import { api } from '../services/api';

interface PatientDialogProps {
  open: boolean;
  patient?: Patient | null;
  onClose: () => void;
  onSave: (data: CreatePatientRequest) => void;
}

const LOCALES = [
  { value: 'hi-IN', label: 'Hindi (India)' },
  { value: 'te-IN', label: 'Telugu (India)' },
  { value: 'en-IN', label: 'English (India)' },
];

const CONSENT_STATUSES = [
  { value: 'GRANTED', label: 'Granted' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'DENIED', label: 'Denied' },
];

const TRIGGER_TYPES = [
  { value: 'discharge_date', label: 'Discharge Date' },
  { value: 'surgery_date', label: 'Surgery Date' },
  { value: 'enrollment_date', label: 'Enrollment Date' },
  { value: 'diagnosis_date', label: 'Diagnosis Date' },
];

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export default function PatientDialog({ open, patient, onClose, onSave }: PatientDialogProps) {
  const [formData, setFormData] = useState<CreatePatientRequest>({
    phoneNumber: '',
    name: '',
    dob: '',
    gender: '',
    preferredLocale: 'hi-IN',
    consentStatus: 'PENDING',
    isTestIdentity: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [knowledgeGraphs, setKnowledgeGraphs] = useState<KnowledgeGraphListItem[]>([]);
  const [loadingKGs, setLoadingKGs] = useState(false);

  // Cascading state
  const [selectedKGId, setSelectedKGId] = useState('');
  const [selectedClassification, setSelectedClassification] = useState('');
  const [conditionStartDate, setConditionStartDate] = useState('');
  const [selectedTriggerType, setSelectedTriggerType] = useState('');

  useEffect(() => {
    if (patient) {
      setFormData({
        phoneNumber: patient.phoneNumber,
        name: patient.name,
        dob: patient.dob || '',
        gender: patient.gender || '',
        preferredLocale: patient.preferredLocale,
        consentStatus: patient.consentStatus,
        isTestIdentity: patient.isTestIdentity ?? false,
      });
      setSelectedKGId(patient.knowledgeGraphId || '');
      setSelectedClassification(patient.classification || '');
      if (patient.conditionStartDate) {
        setConditionStartDate(new Date(patient.conditionStartDate).toISOString().split('T')[0]);
      } else {
        setConditionStartDate('');
      }
      setSelectedTriggerType(patient.triggerType || '');
    } else {
      setFormData({ phoneNumber: '', name: '', dob: '', gender: '', preferredLocale: 'hi-IN', consentStatus: 'PENDING', isTestIdentity: false });
      setSelectedKGId('');
      setSelectedClassification('');
      setConditionStartDate('');
      setSelectedTriggerType('');
    }
    setErrors({});
  }, [patient, open]);

  useEffect(() => {
    if (open) loadKnowledgeGraphs();
  }, [open]);

  const loadKnowledgeGraphs = async () => {
    try {
      setLoadingKGs(true);
      const response = await api.get('/knowledge-graphs');
      setKnowledgeGraphs(response.data || []);
    } catch {
      setKnowledgeGraphs([]);
    } finally {
      setLoadingKGs(false);
    }
  };

  const activeKGs = knowledgeGraphs.filter((kg) => kg.status === 'ACTIVE');
  const selectedKG = knowledgeGraphs.find((kg) => kg.id === selectedKGId) ?? null;
  const availableClassifications = selectedKG?.classifications ?? [];

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.phoneNumber) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!/^\+\d{7,15}$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Phone number must include country code (e.g. +911234567890)';
    }
    if (!formData.name || formData.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    }
    if (selectedKG?.conditionType === 'hybrid' && !selectedTriggerType) {
      newErrors.triggerType = 'Trigger type is required for hybrid conditions';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;

    const kg = selectedKG;
    onSave({
      ...formData,
      condition: kg?.condition || undefined,
      classification: selectedClassification || undefined,
      knowledgeGraphId: selectedKGId || undefined,
      conditionStartDate: conditionStartDate ? new Date(conditionStartDate).toISOString() : undefined,
      triggerType: selectedTriggerType || undefined,
    });
  };

  const handleChange = (field: keyof CreatePatientRequest) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setFormData({ ...formData, [field]: event.target.value });
      if (errors[field]) setErrors({ ...errors, [field]: '' });
    };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{patient ? 'Edit Patient' : 'Add New Patient'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          <TextField
            label="Phone Number"
            value={formData.phoneNumber}
            onChange={handleChange('phoneNumber')}
            error={!!errors.phoneNumber}
            helperText={errors.phoneNumber || 'Include country code, e.g. +911234567890'}
            fullWidth
            required
            disabled={!!patient}
          />

          <TextField
            label="Full Name"
            value={formData.name}
            onChange={handleChange('name')}
            error={!!errors.name}
            helperText={errors.name}
            fullWidth
            required
          />

          <TextField
            label="Date of Birth"
            type="date"
            value={formData.dob}
            onChange={handleChange('dob')}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />

          <TextField
            select
            label="Gender"
            value={formData.gender}
            onChange={handleChange('gender')}
            fullWidth
          >
            <MenuItem value=""><em>Not specified</em></MenuItem>
            {GENDER_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Preferred Language"
            value={formData.preferredLocale}
            onChange={handleChange('preferredLocale')}
            fullWidth
            required
          >
            {LOCALES.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Consent Status"
            value={formData.consentStatus}
            onChange={handleChange('consentStatus')}
            fullWidth
            required
          >
            {CONSENT_STATUSES.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>

          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={formData.isTestIdentity ?? false}
                  onChange={(e) => setFormData({ ...formData, isTestIdentity: e.target.checked })}
                />
              }
              label="Test identity"
            />
            <FormHelperText sx={{ ml: 4, mt: -1 }} error={formData.isTestIdentity}>
              Never check this for a real patient — clinical facts are automatically wiped when this patient's condition changes.
            </FormHelperText>
          </Box>

          {/* Pick list 1: Condition — v{Version} */}
          <TextField
            select
            label="Condition (Optional)"
            value={selectedKGId}
            onChange={(e) => {
              setSelectedKGId(e.target.value);
              setSelectedClassification('');
              setSelectedTriggerType('');
            }}
            fullWidth
            disabled={loadingKGs}
            helperText={
              loadingKGs
                ? 'Loading…'
                : activeKGs.length === 0
                ? 'No active knowledge graphs available. Upload and activate one first.'
                : `${activeKGs.length} condition(s) available`
            }
          >
            <MenuItem value=""><em>None</em></MenuItem>
            {activeKGs.map((kg) => (
              <MenuItem key={kg.id} value={kg.id}>
                {kg.condition} — v{kg.version}
              </MenuItem>
            ))}
          </TextField>

          {/* Pick list 2: Classification (cascades from pick list 1) */}
          {selectedKGId && availableClassifications.length > 0 && (
            <TextField
              select
              label="Classification"
              value={selectedClassification}
              onChange={(e) => setSelectedClassification(e.target.value)}
              fullWidth
              helperText="Select the patient's clinical subtype or risk tier"
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {availableClassifications.map((cls) => (
                <MenuItem key={cls} value={cls}>{cls}</MenuItem>
              ))}
            </TextField>
          )}

          {/* Pick list 3: Trigger Type — only shown for hybrid conditions */}
          {selectedKGId && selectedKG?.conditionType === 'hybrid' && (
            <TextField
              select
              label="Trigger Type"
              value={selectedTriggerType}
              onChange={(e) => setSelectedTriggerType(e.target.value)}
              fullWidth
              required
              error={!!errors.triggerType}
              helperText={errors.triggerType || 'Select the clinical event that starts the care timeline'}
            >
              {TRIGGER_TYPES.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
          )}

          {/* Condition start date — only shown when a KG is selected */}
          {selectedKGId && (
            <TextField
              label="Condition Start Date"
              type="date"
              value={conditionStartDate}
              onChange={(e) => setConditionStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
              helperText="Date of surgery, diagnosis, discharge, or enrolment — used to determine recovery phase"
            />
          )}

          {loadingKGs && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" color="primary">
          {patient ? 'Update' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
