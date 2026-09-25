import { Router, Request, Response, NextFunction } from 'express';
import {
  findUserByEmail,
  countUsers,
  createUser,
  listUsers,
  updateUser,
  deleteUser,
  updateLastLogin,
} from './user.service';
import { generateToken, comparePassword, hashPassword } from './jwt';
import { authMiddleware, requireRole } from './middleware';
import { logger } from '../../core/logger';

const router = Router();

const VALID_ROLES = ['super_admin', 'admin', 'user', 'reviewer'] as const;
type Role = typeof VALID_ROLES[number];

/**
 * POST /v1/api/auth/bootstrap
 *
 * Creates the very first super_admin user when the users table is empty.
 * This endpoint requires NO authentication and is the only way to seed
 * the system without running a CLI script.
 *
 * Returns 409 if any user already exists — use POST /v1/api/auth/users instead.
 */
router.post('/bootstrap', async (req: Request, res: Response): Promise<void> => {
  const total = await countUsers();
  if (total > 0) {
    res.status(409).json({
      error: 'Users already exist. Use POST /v1/api/auth/users to add more.',
    });
    return;
  }

  const { email, password, fullName } = req.body as {
    email: string;
    password: string;
    fullName?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await createUser({ email, passwordHash, role: 'super_admin', fullName });
    logger.info('Bootstrap: super_admin created', { email: user.email });
    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (err: any) {
    logger.error('Bootstrap failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /v1/api/auth/login
 *
 * Authenticates a user and returns a JWT token.
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const user = await findUserByEmail(email);
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const passwordMatch = await comparePassword(password, user.encryptedPassword);
  if (!passwordMatch) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  await updateLastLogin(user.email);

  const token = generateToken(
    { userId: user.id, email: user.email, role: user.role },
    '8h'
  );

  logger.info('User logged in', { email: user.email, role: user.role });
  res.status(200).json({ token, role: user.role, email: user.email });
});

/**
 * POST /v1/api/auth/users
 *
 * Creates a new user. Requires admin or super_admin role.
 * Only super_admin can create another super_admin.
 */
router.post(
  '/users',
  (req: Request, res: Response, next: NextFunction) => authMiddleware(req, res, next),
  (req: Request, res: Response, next: NextFunction) =>
    requireRole('admin', 'super_admin')(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const { email, password, role, fullName } = req.body as {
      email: string;
      password: string;
      role: Role;
      fullName?: string;
    };

    if (!email || !password || !role) {
      res.status(400).json({ error: 'email, password, and role are required' });
      return;
    }
    if (!VALID_ROLES.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    if (role === 'super_admin' && req.user?.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super_admin can create super_admin users' });
      return;
    }

    try {
      const passwordHash = await hashPassword(password);
      const user = await createUser({ email, passwordHash, role, fullName });
      logger.info('User created', { email: user.email, role: user.role, by: req.user?.email });
      res.status(201).json({ id: user.id, email: user.email, role: user.role });
    } catch (err: any) {
      if (err.code === 'P2002') {
        res.status(409).json({ error: 'A user with this email already exists' });
        return;
      }
      logger.error('Failed to create user', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /v1/api/auth/users
 *
 * Lists all users (without password hashes). Requires admin or super_admin.
 */
router.get(
  '/users',
  (req: Request, res: Response, next: NextFunction) => authMiddleware(req, res, next),
  (req: Request, res: Response, next: NextFunction) =>
    requireRole('admin', 'super_admin')(req, res, next),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const users = await listUsers();
      res.json({ users });
    } catch (err: any) {
      logger.error('Failed to list users', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PUT /v1/api/auth/users/:id
 *
 * Updates a user's password, role, fullName, or active status.
 * Only super_admin can assign the super_admin role.
 */
router.put(
  '/users/:id',
  (req: Request, res: Response, next: NextFunction) => authMiddleware(req, res, next),
  (req: Request, res: Response, next: NextFunction) =>
    requireRole('admin', 'super_admin')(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;
    const { password, role, fullName, isActive } = req.body as {
      password?: string;
      role?: Role;
      fullName?: string;
      isActive?: boolean;
    };

    if (!password && !role && fullName === undefined && isActive === undefined) {
      res.status(400).json({ error: 'At least one field to update is required' });
      return;
    }
    if (role && !VALID_ROLES.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    if (role === 'super_admin' && req.user?.role !== 'super_admin') {
      res.status(403).json({ error: 'Only super_admin can assign super_admin role' });
      return;
    }

    const updates: Parameters<typeof updateUser>[1] = {};
    if (password) updates.passwordHash = await hashPassword(password);
    if (role) updates.role = role;
    if (fullName !== undefined) updates.fullName = fullName;
    if (isActive !== undefined) updates.isActive = isActive;

    try {
      await updateUser(id, updates);
      logger.info('User updated', { id, by: req.user?.email });
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      logger.error('Failed to update user', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * DELETE /v1/api/auth/users/:id
 *
 * Deletes a user. Requires super_admin. Cannot delete yourself.
 */
router.delete(
  '/users/:id',
  (req: Request, res: Response, next: NextFunction) => authMiddleware(req, res, next),
  (req: Request, res: Response, next: NextFunction) =>
    requireRole('super_admin')(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params['id'] as string;

    if (id === req.user?.userId) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    try {
      await deleteUser(id);
      logger.info('User deleted', { id, by: req.user?.email });
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      logger.error('Failed to delete user', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
