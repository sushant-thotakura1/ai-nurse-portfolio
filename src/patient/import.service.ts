import Papa from 'papaparse';
import { patientService } from './service';
import { logger } from '../core/logger';

interface ImportRow {
  phoneNumber: string;
  name: string;
  dob?: string;
  gender?: string;
  preferredLocale: string;
  consentStatus: string;
  metadata?: string;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

interface ParseResult {
  data: ImportRow[];
  errors: ValidationError[];
}

interface ImportResult {
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

export class PatientImportService {
  private readonly requiredFields = [
    'phoneNumber',
    'name',
    'preferredLocale',
    'consentStatus',
  ];

  private readonly validConsentStatuses = ['GRANTED', 'DENIED', 'PENDING'];

  /**
   * Parse CSV data and validate
   */
  async parseCSV(csvData: string): Promise<ParseResult> {
    return new Promise((resolve) => {
      const data: ImportRow[] = [];
      const errors: ValidationError[] = [];

      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          results.data.forEach((row: any, index: number) => {
            const validationErrors = this.validateRow(row, index + 1);

            if (validationErrors.length > 0) {
              errors.push(...validationErrors);
            } else {
              data.push(row as ImportRow);
            }
          });

          resolve({ data, errors });
        },
      });
    });
  }

  /**
   * Validate a single row
   */
  private validateRow(row: any, rowNumber: number): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required fields
    for (const field of this.requiredFields) {
      if (!row[field] || row[field].trim() === '') {
        errors.push({
          row: rowNumber,
          field,
          message: `Missing required field: ${field}`,
        });
      }
    }

    // Validate phone number format
    if (row.phoneNumber && !this.isValidPhoneNumber(row.phoneNumber)) {
      errors.push({
        row: rowNumber,
        field: 'phoneNumber',
        message: 'Invalid phone number format',
      });
    }

    // Validate consent status
    if (
      row.consentStatus &&
      !this.validConsentStatuses.includes(row.consentStatus.toUpperCase())
    ) {
      errors.push({
        row: rowNumber,
        field: 'consentStatus',
        message: `Invalid consent status. Must be one of: ${this.validConsentStatuses.join(', ')}`,
      });
    }

    return errors;
  }

  /**
   * Validate phone number format (basic validation)
   */
  private isValidPhoneNumber(phone: string): boolean {
    // Indian phone number: +91 followed by 10 digits
    return /^\+91\d{10}$/.test(phone);
  }

  /**
   * Import patients from CSV data
   */
  async importPatients(csvData: string): Promise<ImportResult> {
    logger.info('Starting patient import');

    const parseResult = await this.parseCSV(csvData);

    if (parseResult.errors.length > 0) {
      logger.error('CSV validation failed', {
        errorCount: parseResult.errors.length,
      });
    }

    let successful = 0;
    let failed = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < parseResult.data.length; i++) {
      const row = parseResult.data[i];
      const rowNumber = i + 1;

      try {
        // Check if patient already exists
        const existing = await patientService.getPatientByPhone(row.phoneNumber);

        if (existing) {
          logger.info('Patient already exists, skipping', {
            phoneNumber: row.phoneNumber.slice(-4),
          });
          skipped++;
          continue;
        }

        // Create new patient
        const VALID_GENDERS = ['male', 'female', 'prefer_not_to_say'];
        const rawGender = row.gender?.toLowerCase().trim();
        const gender = rawGender && VALID_GENDERS.includes(rawGender) ? rawGender : undefined;

        await patientService.createPatient({
          phoneNumber: row.phoneNumber,
          name: row.name,
          dob: row.dob,
          gender,
          preferredLocale: row.preferredLocale,
          consentStatus: row.consentStatus.toUpperCase(),
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });

        successful++;

        logger.info('Patient imported successfully', {
          phoneNumber: row.phoneNumber.slice(-4),
        });
      } catch (error: any) {
        logger.error('Failed to import patient', {
          row: rowNumber,
          error: error.message,
        });

        failed++;
        errors.push({
          row: rowNumber,
          error: error.message,
        });
      }
    }

    logger.info('Patient import completed', {
      successful,
      failed,
      skipped,
      total: parseResult.data.length,
    });

    return {
      successful,
      failed,
      skipped,
      errors,
    };
  }

  /**
   * Generate import template CSV
   */
  generateTemplate(): string {
    const headers = [
      'phoneNumber',
      'name',
      'dob',
      'gender',
      'preferredLocale',
      'consentStatus',
      'metadata',
    ];

    const exampleRow = [
      '+919876543210',
      'John Doe',
      '1985-05-15',
      'male',
      'hi-IN',
      'GRANTED',
      '{}',
    ];

    return `${headers.join(',')}\n${exampleRow.join(',')}`;
  }
}

export const patientImportService = new PatientImportService();
