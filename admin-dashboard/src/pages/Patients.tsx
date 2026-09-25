import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Upload as UploadIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import PatientTable from '../components/PatientTable';
import PatientDialog from '../components/PatientDialog';
import PatientImport from '../components/PatientImport';
import { Patient, CreatePatientRequest, patientApi } from '../services/api';

export default function Patients() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  const loadPatients = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await patientApi.getPatients();
      setPatients(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load patients');
      console.error('Failed to load patients:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  const handleAddPatient = () => {
    setSelectedPatient(null);
    setDialogOpen(true);
  };

  const handleEditPatient = (patient: Patient) => {
    setSelectedPatient(patient);
    setDialogOpen(true);
  };

  const handleSavePatient = async (data: CreatePatientRequest) => {
    try {
      if (selectedPatient) {
        await patientApi.updatePatient(selectedPatient.id, data);
      } else {
        await patientApi.createPatient(data);
      }
      setDialogOpen(false);
      loadPatients();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save patient');
    }
  };

  const handleImport = async (file: File) => {
    const result = await patientApi.importPatients(file);
    if (result.successful > 0) {
      loadPatients();
    }
    return result;
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4" gutterBottom>
            Patients
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage patient records and information
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadPatients}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setImportOpen(true)}
          >
            Import CSV
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddPatient}
          >
            Add Patient
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <PatientTable patients={patients} onEditPatient={handleEditPatient} />
      )}

      <PatientDialog
        open={dialogOpen}
        patient={selectedPatient}
        onClose={() => setDialogOpen(false)}
        onSave={handleSavePatient}
      />

      <PatientImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />
    </Box>
  );
}
