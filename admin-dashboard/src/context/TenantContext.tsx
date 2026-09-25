// admin-dashboard/src/context/TenantContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { tenantStore } from '../services/tenantStore';
import axios from 'axios';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings?: { whatsappSessionTimeoutMinutes?: number } | null;
}

interface TenantContextValue {
  tenantId: string;
  setTenantId: (id: string) => void;
  tenants: Tenant[];
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextValue | null>(null);

const LS_KEY = 'super_admin_tenant';

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantIdState] = useState<string>(tenantStore.get());
  const [isLoading, setIsLoading] = useState(true);

  const setTenantId = (id: string) => {
    tenantStore.set(id);
    setTenantIdState(id);
    localStorage.setItem(LS_KEY, id);
  };

  useEffect(() => {
    // Fetch tenant list; auth token is read from localStorage
    axios
      .get('/v1/api/admin/tenants', {
        headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('auth') ?? '{}').token ?? ''}` },
      })
      .then(({ data }) => {
        const list: Tenant[] = data.tenants ?? [];
        setTenants(list);

        if (list.length === 0) {
          setIsLoading(false);
          return;
        }

        // Restore from localStorage; validate it still exists in the list
        const stored = localStorage.getItem(LS_KEY);
        const valid = stored && list.some((t) => t.id === stored);
        const resolved = valid ? stored! : list[0].id;

        setTenantId(resolved);
        setIsLoading(false);
      })
      .catch((err: any) => {
        if (err.response?.status === 401) {
          localStorage.removeItem('auth');
          window.location.href = '/login';
        }
        setIsLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TenantContext.Provider value={{ tenantId, setTenantId, tenants, isLoading }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    // Outside provider (regular admin) — return inert defaults so components
    // can call useTenant() without conditional hooks
    return {
      tenantId: tenantStore.get(),
      setTenantId: () => {},
      tenants: [],
      isLoading: false,
    };
  }
  return ctx;
}
