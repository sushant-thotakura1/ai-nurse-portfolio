import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  TablePagination,
  Box,
  Typography,
} from '@mui/material';
import { Edit as EditIcon, Phone as PhoneIcon } from '@mui/icons-material';
import { Patient } from '../services/api';

interface PatientTableProps {
  patients: Patient[];
  onEditPatient: (patient: Patient) => void;
}

export default function PatientTable({ patients, onEditPatient }: PatientTableProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const getConsentStatusColor = (status: string) => {
    switch (status) {
      case 'GRANTED':
        return 'success';
      case 'DENIED':
        return 'error';
      case 'PENDING':
        return 'warning';
      default:
        return 'default';
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatPhoneNumber = (phone: string) => {
    // Mask phone number for privacy (show last 4 digits)
    if (phone.length <= 4) return '****';
    return '*'.repeat(phone.length - 4) + phone.slice(-4);
  };

  const formatGender = (gender?: string) => {
    if (gender === 'male') return 'Male';
    if (gender === 'female') return 'Female';
    if (gender === 'prefer_not_to_say') return 'Prefer not to say';
    return '—';
  };

  const calculatePhaseInfo = (conditionStartDate?: string) => {
    if (!conditionStartDate) return null;

    const startDate = new Date(conditionStartDate);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    let phase = '';
    let color: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' = 'default';

    if (daysSince <= 7) {
      phase = 'Phase I';
      color = 'error';
    } else if (daysSince <= 30) {
      phase = 'Phase II';
      color = 'warning';
    } else if (daysSince <= 90) {
      phase = 'Phase III';
      color = 'info';
    } else {
      phase = 'Post-Recovery';
      color = 'success';
    }

    return { phase, daysSince, color };
  };

  if (patients.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body1" color="text.secondary">
          No patients found. Create a patient or import from CSV.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ width: '100%', overflow: 'hidden' }}>
      <TableContainer>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Phone Number</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Date of Birth</TableCell>
              <TableCell>Gender</TableCell>
              <TableCell>Health Condition</TableCell>
              <TableCell>Recovery Phase</TableCell>
              <TableCell>Locale</TableCell>
              <TableCell>Consent Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {patients
              .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
              .map((patient) => {
                const phaseInfo = calculatePhaseInfo(patient.conditionStartDate);
                return (
                  <TableRow key={patient.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PhoneIcon fontSize="small" color="action" />
                        {formatPhoneNumber(patient.phoneNumber)}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {patient.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {patient.dob ? (
                        <Typography variant="body2">
                          {formatDate(patient.dob)}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color={patient.gender ? 'text.primary' : 'text.secondary'}>
                        {formatGender(patient.gender)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {patient.condition ? (
                        <Chip label={patient.condition} size="small" color="info" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Not assigned
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {phaseInfo ? (
                        <Box>
                          <Chip
                            label={`${phaseInfo.phase} (Day ${phaseInfo.daysSince})`}
                            size="small"
                            color={phaseInfo.color}
                          />
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={patient.preferredLocale} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={patient.consentStatus}
                        color={getConsentStatusColor(patient.consentStatus)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => onEditPatient(patient)}
                        color="primary"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={patients.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </Paper>
  );
}
