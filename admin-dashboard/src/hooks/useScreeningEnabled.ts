import { useCallback, useEffect, useState } from 'react';
import { useTenant } from '../context/TenantContext';
import { screeningApi } from '../services/screeningApi';

/**
 * Whether the currently-active tenant has the `screening` capability.
 *
 * Works for both roles: it calls GET /features on the tenant-scoped API
 * (the `api` axios instance already targets /v1/api/<active-tenant>). Re-runs
 * whenever the active tenant changes (super-admin tenant switch also remounts
 * the route tree via <Routes key={tenantId}>, so this fires again anyway).
 *
 * `error` is true only when the /features request itself threw — that is a
 * different situation from the capability being off, and the UI must not show
 * the neutral "not enabled" message during an outage. `retry` re-runs the check
 * (also used when a records fetch 404s, i.e. the tenant was toggled off).
 */
export function useScreeningEnabled(): {
  enabled: boolean;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const { tenantId } = useTenant();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    screeningApi
      .getFeatures()
      .then((f) => {
        if (!cancelled) {
          setEnabled(Array.isArray(f.enabledCapabilities) && f.enabledCapabilities.includes('screening'));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error('useScreeningEnabled: GET /features failed', e);
          setEnabled(false);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, nonce]);

  return { enabled, loading, error, retry };
}
