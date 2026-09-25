// screening-web/src/api.ts

export type ApiError = Error & { status?: number; noTenant?: boolean };

/** First path segment, e.g. "/kemhrc/foo" -> "kemhrc". null for "/" or "". */
export function tenantSlugFromPath(): string | null {
  const seg = window.location.pathname.split('/').filter(Boolean)[0];
  return seg && /^[a-z0-9][a-z0-9-]*$/i.test(seg) ? seg : null;
}

/** The screening API base for this page, or null if no tenant can be determined. */
export function apiBase(): string | null {
  const explicit = import.meta.env.VITE_API_BASE as string | undefined;
  if (explicit) return explicit;
  const slug = tenantSlugFromPath();
  return slug ? `/v1/api/${slug}/screening` : null;
}

function noTenantError(): ApiError {
  const err: ApiError = new Error('No tenant in URL');
  err.status = 0;
  err.noTenant = true;
  return err;
}

async function postJSON(path: string, body?: unknown) {
  const base = apiBase();
  if (base === null) throw noTenantError();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const err: ApiError = new Error(`Request to ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function getJSON(path: string) {
  const base = apiBase();
  if (base === null) throw noTenantError();
  const res = await fetch(`${base}${path}`, { method: 'GET' });
  if (!res.ok) {
    const err: ApiError = new Error(`Request to ${path} failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export function startSession(filledBy: 'patient' | 'family_lar' | 'hcw') {
  return postJSON('/sessions', { filledBy });
}

export function submitAnswer(sessionId: string, questionId: string, value: unknown) {
  return postJSON(`/sessions/${sessionId}/answers`, { questionId, value });
}

export function completeSession(sessionId: string) {
  return postJSON(`/sessions/${sessionId}/complete`);
}

export function getSessionState(sessionId: string) {
  return getJSON(`/sessions/${sessionId}/state`);
}
