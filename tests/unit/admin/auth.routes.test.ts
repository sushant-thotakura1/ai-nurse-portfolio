import express from 'express';
import request from 'supertest';

// Mock dependencies before importing the router
jest.mock('../../../src/admin/auth/users');
jest.mock('../../../src/admin/auth/jwt');
jest.mock('../../../src/admin/auth/middleware');

import { findUserByEmail, addUser } from '../../../src/admin/auth/users';
import { generateToken, comparePassword, hashPassword } from '../../../src/admin/auth/jwt';
import { authMiddleware, requireRole } from '../../../src/admin/auth/middleware';

import authRouter from '../../../src/admin/auth/auth.routes';

// authMiddleware and requireRole pass through in tests
(authMiddleware as jest.Mock).mockImplementation((_req: any, _res: any, next: any) => next());
(requireRole as jest.Mock).mockReturnValue((_req: any, _res: any, next: any) => next());

const app = express();
app.use(express.json());
app.use('/v1/api/auth', authRouter);

beforeEach(() => {
  jest.clearAllMocks();
  (authMiddleware as jest.Mock).mockImplementation((_req: any, _res: any, next: any) => next());
  (requireRole as jest.Mock).mockReturnValue((_req: any, _res: any, next: any) => next());
});

// ── POST /login ───────────────────────────────────────────────────────────────

describe('POST /v1/api/auth/login', () => {
  it('returns 200 and token for valid credentials', async () => {
    (findUserByEmail as jest.Mock).mockReturnValue({
      email: 'admin@test.com',
      passwordHash: 'mock-bcrypt-hash',
      role: 'admin',
    });
    (comparePassword as jest.Mock).mockResolvedValue(true);
    (generateToken as jest.Mock).mockReturnValue('mock.jwt.token');

    const res = await request(app)
      .post('/v1/api/auth/login')
      .send({ email: 'admin@test.com', password: 'test-password' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      token: 'mock.jwt.token',
      role: 'admin',
      email: 'admin@test.com',
    });
    expect(generateToken).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'admin@test.com', role: 'admin' }),
      '3600s'
    );
  });

  it('returns 401 when user not found', async () => {
    (findUserByEmail as jest.Mock).mockReturnValue(undefined);

    const res = await request(app)
      .post('/v1/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'test-wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Invalid credentials' });
  });

  it('returns 401 when password does not match', async () => {
    (findUserByEmail as jest.Mock).mockReturnValue({
      email: 'admin@test.com',
      passwordHash: 'mock-bcrypt-hash',
      role: 'admin',
    });
    (comparePassword as jest.Mock).mockResolvedValue(false);

    const res = await request(app)
      .post('/v1/api/auth/login')
      .send({ email: 'admin@test.com', password: 'test-wrong' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when email or password missing', async () => {
    const res = await request(app)
      .post('/v1/api/auth/login')
      .send({ email: 'admin@test.com' });

    expect(res.status).toBe(400);
  });
});

// ── POST /add-user ────────────────────────────────────────────────────────────

describe('POST /v1/api/auth/add-user', () => {
  it('returns 201 on successful user creation', async () => {
    (hashPassword as jest.Mock).mockResolvedValue('mock-bcrypt-hash-new');
    (addUser as jest.Mock).mockImplementation(() => {});

    const res = await request(app)
      .post('/v1/api/auth/add-user')
      .set('Authorization', 'Bearer mock.token')
      .send({ email: 'new@test.com', password: 'test-password', role: 'user' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true });
    expect(addUser).toHaveBeenCalledWith({
      email: 'new@test.com',
      passwordHash: 'mock-bcrypt-hash-new',
      role: 'user',
    });
  });

  it('returns 409 when user already exists', async () => {
    (hashPassword as jest.Mock).mockResolvedValue('mock-bcrypt-hash');
    (addUser as jest.Mock).mockImplementation(() => {
      throw new Error('User already exists');
    });

    const res = await request(app)
      .post('/v1/api/auth/add-user')
      .set('Authorization', 'Bearer mock.token')
      .send({ email: 'admin@test.com', password: 'test-password', role: 'user' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'User already exists' });
  });

  it('returns 400 when required fields missing', async () => {
    const res = await request(app)
      .post('/v1/api/auth/add-user')
      .set('Authorization', 'Bearer mock.token')
      .send({ email: 'new@test.com' }); // missing password and role

    expect(res.status).toBe(400);
  });
});
