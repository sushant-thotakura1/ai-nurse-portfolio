import { useState, useRef } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Alert,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  Upload as UploadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { ImportResult } from '../services/api';

interface PatientImportProps {
  open: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<ImportResult>;
}

export default function PatientImport({ open, onClose, onImport }: PatientImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setResult(null);
    } else {
      alert('Please select a valid CSV file');
    }
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    try {
      const importResult = await onImport(file);
      setResult(importResult);
    } catch (error) {
      console.error('Import failed:', error);
      alert('Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    onClose();
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Import Patients from CSV</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Alert severity="info">
            CSV file should have columns: phoneNumber, name, dob (optional), preferredLocale,
            consentStatus
          </Alert>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            id="csv-file-input"
          />
          <label htmlFor="csv-file-input">
            <Button
              variant="outlined"
              component="span"
              startIcon={<UploadIcon />}
              fullWidth
              disabled={importing}
            >
              Select CSV File
            </Button>
          </label>

          {file && (
            <Box sx={{ p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
              <Typography variant="body2">
                Selected file: <strong>{file.name}</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Size: {(file.size / 1024).toFixed(2)} KB
              </Typography>
            </Box>
          )}

          {importing && (
            <Box>
              <Typography variant="body2" gutterBottom>
                Importing patients...
              </Typography>
              <LinearProgress />
            </Box>
          )}

          {result && (
            <Box>
              <Alert
                severity={result.failed === 0 ? 'success' : 'warning'}
                icon={result.failed === 0 ? <CheckCircleIcon /> : <ErrorIcon />}
              >
                Import completed: {result.successful} successful, {result.failed} failed,{' '}
                {result.skipped} skipped
              </Alert>

              {result.errors.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Errors:
                  </Typography>
                  <List dense>
                    {result.errors.slice(0, 10).map((error, index) => (
                      <ListItem key={index}>
                        <ListItemText
                          primary={`Row ${error.row}: ${error.field}`}
                          secondary={error.message}
                        />
                      </ListItem>
                    ))}
                    {result.errors.length > 10 && (
                      <ListItem>
                        <ListItemText
                          secondary={`... and ${result.errors.length - 10} more errors`}
                        />
                      </ListItem>
                    )}
                  </List>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        {result ? (
          <>
            <Button onClick={handleReset}>Import Another File</Button>
            <Button onClick={handleClose} variant="contained">
              Close
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleClose} disabled={importing}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              variant="contained"
              disabled={!file || importing}
            >
              Import
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
