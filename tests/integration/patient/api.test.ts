import request from 'supertest';
import express from 'express';
import patientRoutes from '../../../src/patient/routes';

// Mock the service
jest.mock('../../../src/patient/service', () => ({
  patientService: {
    createPatient: jest.fn(),
    getPatientById: jest.fn(),
    getAllPatients: jest.fn(),
    updatePatient: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/patients', patientRoutes);

describe('Patient API Routes', () => {
  describe('POST /patients', () => {
    it('should create a new patient', async () => {
      const mockPatient = { id: 'uuid-123', phoneNumber: '+919876543210' };
      const { patientService } = require('../../../src/patient/service');
      patientService.createPatient.mockResolvedValueOnce(mockPatient);

      const response = await request(app)
        .post('/patients')
        .send({
          phoneNumber: '+919876543210',
          name: 'John Doe',
          preferredLocale: 'hi-IN',
          consentStatus: 'GRANTED',
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('uuid-123');
    });
  });

  describe('GET /patients/:id', () => {
    it('should get patient by ID', async () => {
      const mockPatient = { id: 'uuid-123', name: 'John Doe' };
      const { patientService } = require('../../../src/patient/service');
      patientService.getPatientById.mockResolvedValueOnce(mockPatient);

      const response = await request(app).get('/patients/uuid-123');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('John Doe');
    });
  });
});
