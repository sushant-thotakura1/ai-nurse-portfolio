import { TenantContext } from '../core/types';

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}
