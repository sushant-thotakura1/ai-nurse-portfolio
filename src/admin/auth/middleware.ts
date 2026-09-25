import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt';
import { logger } from '../../core/logger';

/**
 * Extend Express Request to include user property
 */
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

/**
 * Authentication middleware
 * Validates JWT token from Authorization header
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    // Extract token (format: "Bearer <token>")
    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    // Verify token
    const decoded = verifyToken(token);

    // Attach user to request
    req.user = decoded;

    logger.info('Request authenticated', {
      userId: decoded.userId,
      role: decoded.role,
    });

    next();
  } catch (error: any) {
    logger.error('Authentication failed', {
      error: error.message,
    });
    res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Role-based authorization middleware
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Unauthorized access attempt', {
        userId: req.user.userId,
        requiredRoles: roles,
        userRole: req.user.role,
      });
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
