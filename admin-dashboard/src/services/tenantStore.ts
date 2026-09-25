// admin-dashboard/src/services/tenantStore.ts

/**
 * Module-level mutable store holding the currently active tenantId.
 * Lives outside the React tree so the axios singleton's request interceptor
 * can read it synchronously on every request.
 *
 * Default: VITE_TENANT_ID env var (keeps regular admin behaviour unchanged).
 */
let activeTenantId: string = import.meta.env.VITE_TENANT_ID ?? 'default-tenant';

export const tenantStore = {
  get: (): string => activeTenantId,
  set: (id: string): void => { activeTenantId = id; },
};
