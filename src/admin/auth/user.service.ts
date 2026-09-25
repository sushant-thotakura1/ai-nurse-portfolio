import { prisma } from '../../core/database';

export interface UserRecord {
  id: string;
  email: string;
  encryptedPassword: string;
  role: string;
  conditions: string[];
  fullName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export type PublicUser = Omit<UserRecord, 'encryptedPassword'>;

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}

export async function createUser(data: {
  email: string;
  passwordHash: string;
  role: string;
  fullName?: string;
}): Promise<UserRecord> {
  return prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      encryptedPassword: data.passwordHash,
      role: data.role,
      fullName: data.fullName ?? null,
      isActive: true,
    },
  });
}

export async function listUsers(): Promise<PublicUser[]> {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      conditions: true,
      fullName: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateUser(
  id: string,
  updates: {
    passwordHash?: string;
    role?: string;
    fullName?: string;
    isActive?: boolean;
  }
): Promise<void> {
  await prisma.user.update({
    where: { id },
    data: {
      ...(updates.passwordHash !== undefined && { encryptedPassword: updates.passwordHash }),
      ...(updates.role !== undefined && { role: updates.role }),
      ...(updates.fullName !== undefined && { fullName: updates.fullName }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    },
  });
}

export async function updateUserByEmail(
  email: string,
  updates: { role?: string; conditions?: string[] },
): Promise<PublicUser> {
  const user = await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: {
      ...(updates.role !== undefined && { role: updates.role }),
      ...(updates.conditions !== undefined && { conditions: updates.conditions }),
    },
    select: {
      id: true,
      email: true,
      role: true,
      conditions: true,
      fullName: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  return user;
}

export async function deleteUser(id: string): Promise<void> {
  await prisma.user.delete({ where: { id } });
}

export async function updateLastLogin(email: string): Promise<void> {
  await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { lastLoginAt: new Date() },
  });
}
