import { PatientImportService } from '../../../src/patient/import.service';
import { patientService } from '../../../src/patient/service';

// Mock patient service
jest.mock('../../../src/patient/service', () => ({
  patientService: {
    createPatient: jest.fn(),
    getPatientByPhone: jest.fn(),
  },
}));

describe('PatientImportService', () => {
  let importService: PatientImportService;

  beforeEach(() => {
    importService = new PatientImportService();
    jest.clearAllMocks();
  });

  describe('parseCSV', () => {
    it('should parse valid CSV data', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543210,John Doe,1985-05-15,hi-IN,GRANTED
+919876543211,Jane Smith,1990-03-20,te-IN,GRANTED`;

      const result = await importService.parseCSV(csvData);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].phoneNumber).toBe('+919876543210');
      expect(result.data[0].name).toBe('John Doe');
      expect(result.data[1].phoneNumber).toBe('+919876543211');
    });

    it('should detect missing required fields', async () => {
      const csvData = `phoneNumber,name
+919876543210,John Doe`;

      const result = await importService.parseCSV(csvData);

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].row).toBe(1);
      expect(result.errors[0].field).toBe('preferredLocale');
      expect(result.errors[1].row).toBe(1);
      expect(result.errors[1].field).toBe('consentStatus');
    });

    it('should validate phone number format', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
invalid-phone,John Doe,1985-05-15,hi-IN,GRANTED`;

      const result = await importService.parseCSV(csvData);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('phoneNumber');
    });

    it('should validate consent status', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543210,John Doe,1985-05-15,hi-IN,INVALID`;

      const result = await importService.parseCSV(csvData);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('consentStatus');
    });
  });

  describe('importPatients', () => {
    it('should import valid patients successfully', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543210,John Doe,1985-05-15,hi-IN,GRANTED`;

      (patientService.getPatientByPhone as jest.Mock).mockResolvedValue(null);
      (patientService.createPatient as jest.Mock).mockResolvedValue({
        id: 'patient-123',
        phoneNumber: '+919876543210',
      });

      const result = await importService.importPatients(csvData);

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(patientService.createPatient).toHaveBeenCalledTimes(1);
    });

    it('should skip existing patients', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543210,John Doe,1985-05-15,hi-IN,GRANTED`;

      (patientService.getPatientByPhone as jest.Mock).mockResolvedValue({
        id: 'existing-patient',
      });

      const result = await importService.importPatients(csvData);

      expect(result.successful).toBe(0);
      expect(result.skipped).toBe(1);
      expect(patientService.createPatient).not.toHaveBeenCalled();
    });

    it('should handle import errors gracefully', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543210,John Doe,1985-05-15,hi-IN,GRANTED`;

      (patientService.getPatientByPhone as jest.Mock).mockResolvedValue(null);
      (patientService.createPatient as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      const result = await importService.importPatients(csvData);

      expect(result.successful).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });
});
