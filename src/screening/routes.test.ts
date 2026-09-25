// src/screening/routes.test.ts
import request from 'supertest';
import express from 'express';
import screeningRoutes from './routes';
import { screeningService } from './service';

jest.mock('./service', () => ({
  screeningService: {
    start: jest.fn(),
    submitAnswer: jest.fn(),
    complete: jest.fn(),
    getState: jest.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use('/screening', screeningRoutes);

describe('POST /screening/sessions', () => {
  it('starts a session and returns it', async () => {
    (screeningService.start as jest.Mock).mockResolvedValue({ id: 'rec-1', status: 'in_progress' });

    const res = await request(app).post('/screening/sessions').send({ filledBy: 'patient' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'rec-1', status: 'in_progress' });
    expect(screeningService.start).toHaveBeenCalledWith('patient');
  });
});

describe('POST /screening/sessions/:id/answers', () => {
  it('submits an answer and returns the updated record', async () => {
    (screeningService.submitAnswer as jest.Mock).mockResolvedValue({ id: 'rec-1', status: 'in_progress' });

    const res = await request(app)
      .post('/screening/sessions/rec-1/answers')
      .send({ questionId: 'age', value: 65 });

    expect(res.status).toBe(200);
    expect(screeningService.submitAnswer).toHaveBeenCalledWith('rec-1', 'age', 65);
  });

  it('responds 404 when submitAnswer reports the record is not found', async () => {
    (screeningService.submitAnswer as jest.Mock).mockRejectedValue(
      new Error('Screening record not found: rec-x'),
    );

    const res = await request(app)
      .post('/screening/sessions/rec-x/answers')
      .send({ questionId: 'age', value: 65 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Screening record not found: rec-x' });
  });
});

describe('GET /screening/sessions/:id/state', () => {
  it('returns the wizard state snapshot', async () => {
    const snapshot = { id: 'rec-1', status: 'in_progress', totalSteps: 6, steps: [], answers: {}, recommendation: null, stopOutcome: null };
    (screeningService.getState as jest.Mock).mockResolvedValue(snapshot);

    const res = await request(app).get('/screening/sessions/rec-1/state');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(snapshot);
    expect(screeningService.getState).toHaveBeenCalledWith('rec-1');
  });

  it('responds 404 when the record is not found', async () => {
    (screeningService.getState as jest.Mock).mockRejectedValue(
      new Error('Screening record not found: rec-1'),
    );

    const res = await request(app).get('/screening/sessions/rec-1/state');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Screening record not found: rec-1' });
  });
});

describe('POST /screening/sessions/:id/complete', () => {
  it('completes the session and returns the recommendation', async () => {
    (screeningService.complete as jest.Mock).mockResolvedValue({
      id: 'rec-1',
      status: 'completed',
      recommendation: { vaccines: ['influenza'] },
    });

    const res = await request(app).post('/screening/sessions/rec-1/complete');

    expect(res.status).toBe(200);
    expect(res.body.recommendation).toEqual({ vaccines: ['influenza'] });
  });
});
