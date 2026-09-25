import { AsyncLocalStorage } from 'async_hooks';
import { TenantContext } from './types';

/**
 * AsyncLocalStorage for Tenant Context
 *
 * This provides automatic context propagation through async operations
 * without needing to pass tenantContext explicitly through every function call.
 *
 * The context is set by the tenant middleware and can be accessed anywhere
 * in the request handling chain using getTenantContext().
 */
export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Run a callback with tenant context
 *
 * This wraps the callback execution in a context where getTenantContext()
 * will return the provided tenant context.
 *
 * @param context - The tenant context to use
 * @param callback - The function to execute with this context
 * @returns The return value of the callback
 */
export function runWithTenantContext<T>(
  context: TenantContext,
  callback: () => T
): T {
  return tenantContextStorage.run(context, callback);
}

/**
 * Get the current tenant context
 *
 * Returns the tenant context for the current async execution context.
 * This will return undefined if called outside of a context set by
 * runWithTenantContext().
 *
 * @returns The current tenant context, or undefined if not in a tenant context
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantContextStorage.getStore();
}
