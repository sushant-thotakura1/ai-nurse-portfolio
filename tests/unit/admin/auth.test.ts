import { generateToken, verifyToken, hashPassword, comparePassword } from '../../../src/admin/auth/jwt';
import { authMiddleware } from '../../../src/admin/auth/middleware';
import { Request, Response, NextFunction } from 'express';

// Mock jsonwebtoken
jest.mock('jsonwebtoken');
import jwt from 'jsonwebtoken';

// Mock bcrypt
jest.mock('bcrypt');
import bcrypt from 'bcrypt';

describe('JWT Authentication', () => {
  describe('generateToken', () => {
    it('should generate a token with default 7d expiry', () => {
      const payload = { userId: 'user-123', email: 'test@example.com', role: 'admin' };
      const mockToken = 'mock.jwt.token';

      (jwt.sign as jest.Mock).mockReturnValueOnce(mockToken);

      const token = generateToken(payload);

      expect(token).toBe(mockToken);
      expect(jwt.sign).toHaveBeenCalledWith(
        payload,
        expect.any(String),
        expect.objectContaining({ expiresIn: '7d' })
      );
    });

    it('should generate a token with custom expiresIn when provided', () => {
      const payload = { userId: 'user-123', email: 'test@example.com', role: 'admin' };
      const mockToken = 'mock.jwt.token.short';

      (jwt.sign as jest.Mock).mockReturnValueOnce(mockToken);

      const token = generateToken(payload, '3600s');

      expect(token).toBe(mockToken);
      expect(jwt.sign).toHaveBeenCalledWith(
        payload,
        expect.any(String),
        expect.objectContaining({ expiresIn: '3600s' })
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', () => {
      const mockToken = 'valid.jwt.token';
      const mockPayload = { userId: 'user-123', email: 'test@example.com' };

      (jwt.verify as jest.Mock).mockReturnValueOnce(mockPayload);

      const result = verifyToken(mockToken);

      expect(result).toEqual(mockPayload);
      expect(jwt.verify).toHaveBeenCalledWith(mockToken, expect.any(String));
    });

    it('should throw error for invalid token', () => {
      const mockToken = 'invalid.jwt.token';

      (jwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });

      expect(() => verifyToken(mockToken)).toThrow('Invalid token');
    });
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'test-password';
      const hashedPassword = 'hashed_password';

      (bcrypt.hash as jest.Mock).mockResolvedValueOnce(hashedPassword);

      const result = await hashPassword(password);

      expect(result).toBe(hashedPassword);
      expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);
    });
  });

  describe('comparePassword', () => {
    it('should return true for matching passwords', async () => {
      const password = 'test-password';
      const hashedPassword = 'hashed_password';

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await comparePassword(password, hashedPassword);

      expect(result).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith(password, hashedPassword);
    });

    it('should return false for non-matching passwords', async () => {
      const password = 'test-wrong';
      const hashedPassword = 'hashed_password';

      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const result = await comparePassword(password, hashedPassword);

      expect(result).toBe(false);
    });
  });
});

describe('Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    nextFunction = jest.fn();
  });

  it('should call next() for valid token', () => {
    mockRequest.headers = {
      authorization: 'Bearer valid.jwt.token',
    };

    const mockPayload = { userId: 'user-123', email: 'test@example.com' };
    (jwt.verify as jest.Mock).mockReturnValueOnce(mockPayload);

    authMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect((mockRequest as any).user).toEqual(mockPayload);
  });

  it('should return 401 if no token provided', () => {
    mockRequest.headers = {};

    authMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'No token provided',
    });
    expect(nextFunction).not.toHaveBeenCalled();
  });

  it('should return 401 for invalid token', () => {
    mockRequest.headers = {
      authorization: 'Bearer invalid.token',
    };

    (jwt.verify as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Invalid token');
    });

    authMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Invalid token',
    });
    expect(nextFunction).not.toHaveBeenCalled();
  });
});
