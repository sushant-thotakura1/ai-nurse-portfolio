import request from 'supertest';
import app from '../../../src/server';
import { prisma } from '../../../src/core/database';

describe('Call Scheduling API Integration Tests', () => {
  const testTenantId = 'test-tenant-scheduling';
  let testPatientId: string;

  beforeAll(async () => {
    // Create test tenant
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        name: 'Test Tenant for Scheduling',
        slug: 'test-scheduling',
        status: 'ACTIVE',
        settings: {},
      },
    });

    // Create test patient
    const patient = await prisma.patient.create({
      data: {
        tenantId: testTenantId,
        phoneNumber: '+919876540100',
        encryptedName: 'Test Patient',
        preferredLocale: 'hi-IN',
        consentStatus: 'GRANTED',
        consentRecordedAt: new Date(),
      },
    });
    testPatientId = patient.id;
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.scheduledCall.deleteMany({
      where: { tenantId: testTenantId },
    });
    await prisma.patient.deleteMany({
      where: { tenantId: testTenantId },
    });
    await prisma.tenant.delete({
      where: { id: testTenantId },
    });
    await prisma.$disconnect();
  });

  describe('POST /v1/api/:tenantId/scheduling/schedule', () => {
    it('should schedule a new call successfully', async () => {
      const scheduledFor = new Date(Date.now() + 3600000); // 1 hour from now
      const response = await request(app)
        .post(`/v1/api/${testTenantId}/scheduling/schedule`)
        .send({
          patientId: testPatientId,
          callPurpose: 'POST_SURGERY',
          scheduledFor: scheduledFor.toISOString(),
          maxRetries: 3,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.patientId).toBe(testPatientId);
      expect(response.body.callPurpose).toBe('POST_SURGERY');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.retryCount).toBe(0);
      expect(response.body.maxRetries).toBe(3);
      expect(response.body.tenantId).toBe(testTenantId);

      // Verify in database
      const scheduledCall = await prisma.scheduledCall.findUnique({
        where: { id: response.body.id },
      });
      expect(scheduledCall).toBeTruthy();
      expect(scheduledCall?.tenantId).toBe(testTenantId);
    });

    it('should use default maxRetries if not provided', async () => {
      const scheduledFor = new Date(Date.now() + 3600000);
      const response = await request(app)
        .post(`/v1/api/${testTenantId}/scheduling/schedule`)
        .send({
          patientId: testPatientId,
          callPurpose: 'MEDICATION_REMINDER',
          scheduledFor: scheduledFor.toISOString(),
        })
        .expect(201);

      expect(response.body.maxRetries).toBe(3); // Default value
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await request(app)
        .post(`/v1/api/${testTenantId}/scheduling/schedule`)
        .send({
          callPurpose: 'POST_SURGERY',
        })
        .expect(400);

      expect(response.body.error).toContain('Missing required fields');
    });

    it('should isolate tenant data', async () => {
      // Create another tenant
      const otherTenantId = 'other-tenant-scheduling-test';
      await prisma.tenant.create({
        data: {
          id: otherTenantId,
          name: 'Other Tenant',
          slug: 'other-scheduling-test',
          status: 'ACTIVE',
          settings: {},
        },
      });

      // Create patient in other tenant
      const otherPatient = await prisma.patient.create({
        data: {
          tenantId: otherTenantId,
          phoneNumber: '+919876540101',
          encryptedName: 'Other Patient',
          preferredLocale: 'hi-IN',
          consentStatus: 'GRANTED',
          consentRecordedAt: new Date(),
        },
      });

      const scheduledFor = new Date(Date.now() + 3600000);

      // Schedule call in first tenant
      const response1 = await request(app)
        .post(`/v1/api/${testTenantId}/scheduling/schedule`)
        .send({
          patientId: testPatientId,
          callPurpose: 'POST_SURGERY',
          scheduledFor: scheduledFor.toISOString(),
        })
        .expect(201);

      // Schedule call in second tenant
      const response2 = await request(app)
        .post(`/v1/api/${otherTenantId}/scheduling/schedule`)
        .send({
          patientId: otherPatient.id,
          callPurpose: 'POST_SURGERY',
          scheduledFor: scheduledFor.toISOString(),
        })
        .expect(201);

      // Verify both calls exist in their respective tenants
      const call1 = await prisma.scheduledCall.findUnique({
        where: { id: response1.body.id },
      });
      expect(call1?.tenantId).toBe(testTenantId);

      const call2 = await prisma.scheduledCall.findUnique({
        where: { id: response2.body.id },
      });
      expect(call2?.tenantId).toBe(otherTenantId);

      // Clean up
      await prisma.scheduledCall.deleteMany({
        where: { tenantId: otherTenantId },
      });
      await prisma.patient.deleteMany({
        where: { tenantId: otherTenantId },
      });
      await prisma.tenant.delete({
        where: { id: otherTenantId },
      });
    });
  });

  describe('GET /v1/api/:tenantId/scheduling/pending', () => {
    beforeEach(async () => {
      // Clean up any existing scheduled calls
      await prisma.scheduledCall.deleteMany({
        where: { tenantId: testTenantId },
      });
    });

    it('should retrieve pending calls that are due', async () => {
      const pastTime = new Date(Date.now() - 3600000); // 1 hour ago
      const futureTime = new Date(Date.now() + 3600000); // 1 hour from now

      // Create past call (should be included)
      await prisma.scheduledCall.create({
        data: {
          tenantId: testTenantId,
          patientId: testPatientId,
          callPurpose: 'POST_SURGERY',
          scheduledFor: pastTime,
          status: 'PENDING',
          retryCount: 0,
          maxRetries: 3,
        },
      });

      // Create future call (should NOT be included)
      await prisma.scheduledCall.create({
        data: {
          tenantId: testTenantId,
          patientId: testPatientId,
          callPurpose: 'MEDICATION_REMINDER',
          scheduledFor: futureTime,
          status: 'PENDING',
          retryCount: 0,
          maxRetries: 3,
        },
      });

      // Create completed call (should NOT be included)
      await prisma.scheduledCall.create({
        data: {
          tenantId: testTenantId,
          patientId: testPatientId,
          callPurpose: 'GENERAL_CHECKUP',
          scheduledFor: pastTime,
          status: 'COMPLETED',
          retryCount: 0,
          maxRetries: 3,
        },
      });

      const response = await request(app)
        .get(`/v1/api/${testTenantId}/scheduling/pending`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].callPurpose).toBe('POST_SURGERY');
      expect(response.body[0].status).toBe('PENDING');
      expect(response.body[0].patient).toBeDefined();
    });

    it('should return empty array when no pending calls', async () => {
      const response = await request(app)
        .get(`/v1/api/${testTenantId}/scheduling/pending`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('GET /v1/api/:tenantId/scheduling/patient/:patientId', () => {
    beforeEach(async () => {
      await prisma.scheduledCall.deleteMany({
        where: { tenantId: testTenantId },
      });
    });

    it('should retrieve all scheduled calls for a patient', async () => {
      // Create multiple scheduled calls
      await prisma.scheduledCall.createMany({
        data: [
          {
            tenantId: testTenantId,
            patientId: testPatientId,
            callPurpose: 'POST_SURGERY',
            scheduledFor: new Date(Date.now() + 3600000),
            status: 'PENDING',
            retryCount: 0,
            maxRetries: 3,
          },
          {
            tenantId: testTenantId,
            patientId: testPatientId,
            callPurpose: 'MEDICATION_REMINDER',
            scheduledFor: new Date(Date.now() - 3600000),
            status: 'COMPLETED',
            retryCount: 0,
            maxRetries: 3,
          },
        ],
      });

      const response = await request(app)
        .get(`/v1/api/${testTenantId}/scheduling/patient/${testPatientId}`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.every((call: any) => call.patientId === testPatientId)).toBe(true);
    });

    it('should return empty array for patient with no scheduled calls', async () => {
      const response = await request(app)
        .get(`/v1/api/${testTenantId}/scheduling/patient/${testPatientId}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('DELETE /v1/api/:tenantId/scheduling/:id', () => {
    it('should cancel a scheduled call', async () => {
      // Create a scheduled call
      const scheduledCall = await prisma.scheduledCall.create({
        data: {
          tenantId: testTenantId,
          patientId: testPatientId,
          callPurpose: 'POST_SURGERY',
          scheduledFor: new Date(Date.now() + 3600000),
          status: 'PENDING',
          retryCount: 0,
          maxRetries: 3,
        },
      });

      const response = await request(app)
        .delete(`/v1/api/${testTenantId}/scheduling/${scheduledCall.id}`)
        .expect(200);

      expect(response.body.status).toBe('CANCELLED');

      // Verify in database
      const updated = await prisma.scheduledCall.findUnique({
        where: { id: scheduledCall.id },
      });
      expect(updated?.status).toBe('CANCELLED');
    });
  });

  describe('Legacy routes (backward compatibility)', () => {
    it('should support legacy schedule endpoint', async () => {
      const scheduledFor = new Date(Date.now() + 3600000);
      const response = await request(app)
        .post('/api/scheduling/schedule')
        .send({
          patientId: testPatientId,
          callPurpose: 'POST_SURGERY',
          scheduledFor: scheduledFor.toISOString(),
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.status).toBe('PENDING');
    });

    it('should support legacy pending endpoint', async () => {
      const response = await request(app)
        .get('/api/scheduling/pending')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
