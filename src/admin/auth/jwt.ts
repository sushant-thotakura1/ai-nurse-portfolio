import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '../../core/config';
import { logger } from '../../core/logger';

interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Generate JWT token
 */
export function generateToken(payload: JWTPayload, expiresIn: SignOptions['expiresIn'] = '7d'): string {
  try {
    const token = jwt.sign(payload, config.security.jwtSecret, {
      expiresIn,
    });

    logger.info('JWT token generated', {
      userId: payload.userId,
      role: payload.role,
    });

    return token;
  } catch (error: any) {
    logger.error('Failed to generate token', {
      error: error.message,
    });
    throw new Error('Token generation failed');
  }
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, config.security.jwtSecret) as JWTPayload;
    return decoded;
  } catch (error: any) {
    logger.error('Token verification failed', {
      error: error.message,
    });
    throw new Error('Invalid token');
  }
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  } catch (error: any) {
    logger.error('Password hashing failed', {
      error: error.message,
    });
    throw new Error('Password hashing failed');
  }
}

/**
 * Compare password with hashed password
 */
export async function comparePassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  try {
    const isMatch = await bcrypt.compare(password, hashedPassword);
    return isMatch;
  } catch (error: any) {
    logger.error('Password comparison failed', {
      error: error.message,
    });
    throw new Error('Password comparison failed');
  }
}
