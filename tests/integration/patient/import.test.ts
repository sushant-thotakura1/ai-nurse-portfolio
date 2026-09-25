import request from 'supertest';
import app from '../../../src/server';
import { prisma } from '../../../src/core/database';
import { encrypt } from '../../../src/core/encryption';

describe('Patient Import API Integration Tests', () => {
  const testTenantId = 'test-tenant-integration';

  beforeAll(async () => {
    // Create test tenant
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        name: 'Test Tenant for Import',
        slug: 'test-import',
        status: 'ACTIVE',
        settings: {},
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.patient.deleteMany({
      where: { tenantId: testTenantId },
    });
    await prisma.tenant.delete({
      where: { id: testTenantId },
    });
    await prisma.$disconnect();
  });

  describe('POST /v1/api/:tenantId/patients/import', () => {
    it('should import valid patients from CSV', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543210,John Doe,1985-05-15,hi-IN,GRANTED
+919876543211,Jane Smith,1990-03-20,te-IN,GRANTED`;

      const response = await request(app)
        .post(`/v1/api/${testTenantId}/patients/import`)
        .send({ csvData })
        .expect(200);

      expect(response.body.successful).toBe(2);
      expect(response.body.failed).toBe(0);
      expect(response.body.skipped).toBe(0);

      // Verify patients were created in database
      const patient1 = await prisma.patient.findUnique({
        where: { phoneNumber: '+919876543210' },
      });
      expect(patient1).toBeTruthy();
      expect(patient1?.tenantId).toBe(testTenantId);

      const patient2 = await prisma.patient.findUnique({
        where: { phoneNumber: '+919876543211' },
      });
      expect(patient2).toBeTruthy();
      expect(patient2?.tenantId).toBe(testTenantId);
    });

    it('should skip duplicate patients', async () => {
      // First import
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543212,Alice Brown,1988-07-12,hi-IN,GRANTED`;

      await request(app)
        .post(`/v1/api/${testTenantId}/patients/import`)
        .send({ csvData })
        .expect(200);

      // Second import with same data
      const response = await request(app)
        .post(`/v1/api/${testTenantId}/patients/import`)
        .send({ csvData })
        .expect(200);

      expect(response.body.successful).toBe(0);
      expect(response.body.skipped).toBe(1);
      expect(response.body.failed).toBe(0);
    });

    it('should return 400 when CSV data is missing', async () => {
      const response = await request(app)
        .post(`/v1/api/${testTenantId}/patients/import`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('CSV data is required');
    });

    it('should handle invalid CSV data gracefully', async () => {
      const csvData = `phoneNumber,name
invalid-phone,Test User`;

      const response = await request(app)
        .post(`/v1/api/${testTenantId}/patients/import`)
        .send({ csvData })
        .expect(200);

      // Should have validation errors, resulting in 0 imported
      expect(response.body.successful).toBe(0);
    });

    it('should isolate tenant data', async () => {
      // Create another tenant
      const otherTenantId = 'other-tenant-import-test';
      await prisma.tenant.create({
        data: {
          id: otherTenantId,
          name: 'Other Tenant',
          slug: 'other-import-test',
          status: 'ACTIVE',
          settings: {},
        },
      });

      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543213,Bob Wilson,1992-11-25,hi-IN,GRANTED`;

      // Import to first tenant
      await request(app)
        .post(`/v1/api/${testTenantId}/patients/import`)
        .send({ csvData })
        .expect(200);

      // Import same data to second tenant (should succeed, not be considered duplicate)
      const response = await request(app)
        .post(`/v1/api/${otherTenantId}/patients/import`)
        .send({ csvData })
        .expect(200);

      expect(response.body.successful).toBe(1);
      expect(response.body.skipped).toBe(0);

      // Verify both tenants have the patient
      const patientsInTenant1 = await prisma.patient.findMany({
        where: {
          phoneNumber: '+919876543213',
          tenantId: testTenantId,
        },
      });
      expect(patientsInTenant1).toHaveLength(1);

      const patientsInTenant2 = await prisma.patient.findMany({
        where: {
          phoneNumber: '+919876543213',
          tenantId: otherTenantId,
        },
      });
      expect(patientsInTenant2).toHaveLength(1);

      // Clean up
      await prisma.patient.deleteMany({
        where: { tenantId: otherTenantId },
      });
      await prisma.tenant.delete({
        where: { id: otherTenantId },
      });
    });
  });

  describe('GET /v1/api/:tenantId/patients/import/template', () => {
    it('should download CSV template', async () => {
      const response = await request(app)
        .get(`/v1/api/${testTenantId}/patients/import/template`)
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain(
        'attachment; filename=patient-import-template.csv'
      );
      expect(response.text).toContain('phoneNumber,name,dob,preferredLocale,consentStatus,metadata');
      expect(response.text).toContain('+919876543210');
    });
  });

  describe('Legacy routes (backward compatibility)', () => {
    it('should support legacy import endpoint', async () => {
      const csvData = `phoneNumber,name,dob,preferredLocale,consentStatus
+919876543214,Legacy User,1980-01-01,hi-IN,GRANTED`;

      const response = await request(app)
        .post('/api/patients/import')
        .send({ csvData })
        .expect(200);

      expect(response.body.successful).toBe(1);
    });
  });
});
