import path from 'path';
import fs from 'fs';

// Mock fs so we never touch the real filesystem
jest.mock('fs');

// Import after mocking
import {
  loadUsers,
  findUserByEmail,
  addUser,
  type User,
} from '../../../src/admin/auth/users';

const MOCK_USERS: User[] = [
  { email: 'admin@test.com', passwordHash: 'mock-bcrypt-hash-admin', role: 'admin' },
  { email: 'user@test.com',  passwordHash: 'mock-bcrypt-hash-user',  role: 'user'  },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loadUsers', () => {
  it('returns parsed users when file exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_USERS));

    const result = loadUsers();
    expect(result).toEqual(MOCK_USERS);
  });

  it('returns empty array when file does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const result = loadUsers();
    expect(result).toEqual([]);
  });
});

describe('findUserByEmail', () => {
  beforeEach(() => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_USERS));
  });

  it('returns the user when email matches (case-insensitive)', () => {
    const user = findUserByEmail('Admin@Test.com');
    expect(user).toMatchObject({ email: 'admin@test.com', role: 'admin' });
  });

  it('returns undefined when email not found', () => {
    const user = findUserByEmail('nobody@test.com');
    expect(user).toBeUndefined();
  });
});

describe('addUser', () => {
  it('appends new user and writes file', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_USERS));
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

    const newUser: User = { email: 'new@test.com', passwordHash: 'mock-bcrypt-hash-new', role: 'user' };
    addUser(newUser);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenData = JSON.parse((fs.writeFileSync as jest.Mock).mock.calls[0][1]);
    expect(writtenData).toHaveLength(3);
    expect(writtenData[2]).toMatchObject({ email: 'new@test.com', role: 'user' });
  });

  it('throws if user email already exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_USERS));

    const duplicate: User = { email: 'admin@test.com', passwordHash: 'mock-bcrypt-hash', role: 'user' };
    expect(() => addUser(duplicate)).toThrow('User already exists');
  });
});
