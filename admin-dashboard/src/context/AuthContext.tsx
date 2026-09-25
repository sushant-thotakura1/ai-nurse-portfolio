import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { tenantStore } from '../services/tenantStore';

interface AuthState {
  token: string | null;
  role: 'admin' | 'user' | 'super_admin' | 'reviewer' | null;
  email: string | null;
}

interface AuthContextValue extends AuthState {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isReviewer: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'auth';

function readStorage(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, role: null, email: null };

    const parsed = JSON.parse(raw) as AuthState;
    // Validate token expiry
    const decoded = jwtDecode<{ exp: number }>(parsed.token!);
    if (decoded.exp * 1000 < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return { token: null, role: null, email: null };
    }
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return { token: null, role: null, email: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(readStorage);
  const navigate = useNavigate();

  useEffect(() => {
    // Re-validate on mount in case token expired while app was open
    const fresh = readStorage();
    if (!fresh.token && auth.token) {
      setAuth(fresh);
    }
  }, []);

  const login = async (email: string, password: string): Promise<void> => {
    const response = await fetch('/v1/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Login failed');
    }

    const data = await response.json() as { token: string; role: 'admin' | 'user' | 'super_admin' | 'reviewer'; email: string };
    const newAuth: AuthState = { token: data.token, role: data.role, email: data.email };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(newAuth));
    setAuth(newAuth);
    navigate(data.role === 'reviewer' ? '/reviewer' : '/dashboard');
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('super_admin_tenant');
    tenantStore.set(import.meta.env.VITE_TENANT_ID ?? 'default-tenant');
    setAuth({ token: null, role: null, email: null });
    navigate('/login');
  };

  const value: AuthContextValue = {
    ...auth,
    isAdmin: auth.role === 'admin' || auth.role === 'super_admin',
    isSuperAdmin: auth.role === 'super_admin',
    isReviewer: auth.role === 'reviewer' || auth.role === 'admin' || auth.role === 'super_admin',
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
