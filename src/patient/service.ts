import { prisma } from '../core/database';
import { encrypt, decrypt } from '../core/encryption';
import { logger } from '../core/logger';
import { knowledgeGraphService } from '../knowledge-graph/knowledge-graph.service';
import { getTenantContext } from '../core/tenant-context-storage';

interface CreatePatientDTO {
  phoneNumber: string;
  name: string;
  dob?: string;
  gender?: string;
  preferredLocale: string;
  consentStatus: string;
  metadata?: any;
  condition?: string;
  classification?: string;
  conditionStartDate?: string;
  triggerType?: string;
  isTestIdentity?: boolean;
}

interface UpdatePatientDTO {
  name?: string;
  dob?: string;
  gender?: string;
  preferredLocale?: string;
  consentStatus?: string;
  metadata?: any;
  condition?: string;
  classification?: string;
  conditionStartDate?: string;
  triggerType?: string;
  isTestIdentity?: boolean;
}

interface DecryptedPatient {
  id: string;
  phoneNumber: string;
  name: string;
  dob?: string;
  gender?: string | null;
  preferredLocale: string | null;
  consentStatus: string;
  consentRecordedAt?: Date;
  metadata?: any;
  condition?: string | null;
  classification?: string | null;
  conditionStartDate?: Date;
  triggerType?: string | null;
  isTestIdentity: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class PatientService {
  async createPatient(data: CreatePatientDTO): Promise<any> {
    try {
      const tenantContext = getTenantContext();

      if (!tenantContext) {
        throw new Error('Tenant context is required for creating patients');
      }

      const VALID_GENDERS = ['male', 'female', 'prefer_not_to_say'];
      if (data.gender && !VALID_GENDERS.includes(data.gender)) {
        throw new Error(`Invalid gender value: ${data.gender}`);
      }

      logger.info('Creating new patient', {
        phoneNumber: data.phoneNumber.slice(-4),
        tenantId: tenantContext.tenantId,
      });

      const patient = await prisma.patient.create({
        data: {
          phoneNumber: data.phoneNumber,
          encryptedName: encrypt(data.name),
          encryptedDob: data.dob ? encrypt(data.dob) : null,
          gender: data.gender || null,
          preferredLocale: data.preferredLocale,
          consentStatus: data.consentStatus,
          consentRecordedAt: new Date(),
          metadata: data.metadata,
          condition: data.condition,
          classification: data.classification ?? null,
          conditionStartDate: data.conditionStartDate ? new Date(data.conditionStartDate) : null,
          triggerType: data.triggerType ?? null,
          isTestIdentity: data.isTestIdentity ?? false,
          tenantId: tenantContext.tenantId,
        },
      });

      logger.info('Patient created successfully', { patientId: patient.id, tenantId: tenantContext.tenantId });

      return patient;
    } catch (error: any) {
      logger.error('Failed to create patient', { error: error.message });
      throw error;
    }
  }

  async getPatientById(id: string): Promise<DecryptedPatient> {
    try {
      const patient = await prisma.patient.findUnique({ where: { id } });

      if (!patient) {
        throw new Error('Patient not found');
      }

      return this.decryptPatient(patient);
    } catch (error: any) {
      logger.error('Failed to get patient', { error: error.message, patientId: id });
      throw error;
    }
  }

  async getPatientByPhone(phoneNumber: string): Promise<DecryptedPatient | null> {
    try {
      const patient = await prisma.patient.findFirst({ where: { phoneNumber } });

      if (!patient) {
        return null;
      }

      return this.decryptPatient(patient);
    } catch (error: any) {
      logger.error('Failed to get patient by phone', { error: error.message });
      throw error;
    }
  }

  async updatePatient(id: string, data: UpdatePatientDTO): Promise<any> {
    try {
      logger.info('Updating patient', { patientId: id });

      const VALID_GENDERS = ['male', 'female', 'prefer_not_to_say'];
      if (data.gender !== undefined && data.gender && !VALID_GENDERS.includes(data.gender)) {
        throw new Error(`Invalid gender value: ${data.gender}`);
      }

      const updateData: any = {};

      if (data.name) updateData.encryptedName = encrypt(data.name);
      if (data.dob) updateData.encryptedDob = encrypt(data.dob);
      if (data.preferredLocale) updateData.preferredLocale = data.preferredLocale;
      if (data.consentStatus) updateData.consentStatus = data.consentStatus;
      if (data.metadata) updateData.metadata = data.metadata;
      if (data.condition !== undefined) updateData.condition = data.condition;
      if (data.classification !== undefined) updateData.classification = data.classification ?? null;
      if (data.conditionStartDate !== undefined) {
        updateData.conditionStartDate = data.conditionStartDate ? new Date(data.conditionStartDate) : null;
      }
      if (data.triggerType !== undefined) updateData.triggerType = data.triggerType ?? null;
      if (data.gender !== undefined) updateData.gender = data.gender || null;
      if (data.isTestIdentity !== undefined) updateData.isTestIdentity = data.isTestIdentity;

      const patient = await prisma.patient.update({ where: { id }, data: updateData });

      logger.info('Patient updated successfully', { patientId: id });

      return patient;
    } catch (error: any) {
      logger.error('Failed to update patient', { error: error.message, patientId: id });
      throw error;
    }
  }

  async getAllPatients(limit = 50, offset = 0): Promise<DecryptedPatient[]> {
    try {
      const patients = await prisma.patient.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      });

      return patients.map((p) => this.decryptPatient(p));
    } catch (error: any) {
      logger.error('Failed to get all patients', { error: error.message });
      throw error;
    }
  }

  async assignCondition(
    patientId: string,
    condition: string,
    conditionStartDate: Date
  ): Promise<any> {
    try {
      logger.info('Assigning condition to patient', { patientId, condition, conditionStartDate });

      // Validate an active KG exists for this condition before assigning it --
      // deliberately not persisting its id. Patients always resolve to
      // whatever KG is currently ACTIVE for their condition, not a snapshot
      // pinned at assignment time.
      const activeKg = await knowledgeGraphService.getActiveKnowledgeGraph(condition);

      if (!activeKg) {
        throw new Error(`No active knowledge graph found for condition: ${condition}`);
      }

      const patient = await prisma.patient.update({
        where: { id: patientId },
        data: { condition, conditionStartDate },
      });

      logger.info('Condition assigned successfully', { patientId, condition });

      return patient;
    } catch (error: any) {
      logger.error('Failed to assign condition', { error: error.message, patientId, condition });
      throw error;
    }
  }

  private decryptPatient(patient: any): DecryptedPatient {
    let name = '';
    let dob: string | undefined = undefined;

    try {
      if (patient.encryptedName) name = decrypt(patient.encryptedName);
    } catch (error: any) {
      logger.error('Failed to decrypt patient name', { error: error.message, patientId: patient.id });
    }

    try {
      if (patient.encryptedDob) dob = decrypt(patient.encryptedDob);
    } catch (error: any) {
      logger.error('Failed to decrypt patient DOB', { error: error.message, patientId: patient.id });
    }

    return {
      id: patient.id,
      phoneNumber: patient.phoneNumber,
      name,
      dob,
      gender: patient.gender ?? null,
      preferredLocale: patient.preferredLocale,
      consentStatus: patient.consentStatus,
      consentRecordedAt: patient.consentRecordedAt,
      metadata: patient.metadata,
      condition: patient.condition ?? null,
      classification: patient.classification ?? null,
      conditionStartDate: patient.conditionStartDate,
      triggerType: patient.triggerType ?? null,
      isTestIdentity: patient.isTestIdentity ?? false,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    };
  }
}

export const patientService = new PatientService();
