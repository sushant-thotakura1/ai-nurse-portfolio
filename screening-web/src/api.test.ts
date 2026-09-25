// screening-web/src/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startSession, submitAnswer, getSessionState } from './api';

function setPath(path: string) {
  window.history.replaceState({}, '', path);
}

beforeEach(() => {
  global.fetch = vi.fn();
  setPath('/t');
});

afterEach(() => {
  setPath('/');
  vi.unstubAllEnvs();
});

describe('startSession', () => {
  it('POSTs to /sessions and returns the parsed record', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rec-1', status: 'in_progress' }),
    });

    const record = await startSession('patient');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/screening/sessions'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ filledBy: 'patient' }),
      }),
    );
    expect(record.id).toBe('rec-1');
  });
});

describe('submitAnswer', () => {
  it('POSTs the answer for a given session', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rec-1', status: 'in_progress' }),
    });

    await submitAnswer('rec-1', 'age', 65);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/screening/sessions/rec-1/answers'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ questionId: 'age', value: 65 }),
      }),
    );
  });
});

describe('getSessionState', () => {
  it('GETs the session state and returns the parsed body', async () => {
    const body = { id: 'rec-1', status: 'in_progress', totalSteps: 6, steps: [] };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => body,
    });

    const state = await getSessionState('rec-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/screening/sessions/rec-1/state'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(state).toEqual(body);
  });
});

describe('tenant slug from URL path', () => {
  it('derives the API base from the first path segment', async () => {
    setPath('/kemhrc');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rec-1', status: 'in_progress' }),
    });

    await startSession('patient');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/api/kemhrc/screening/sessions'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses a hyphenated tenant slug', async () => {
    setPath('/apollo-hospitals/some/deep/path');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rec-1', status: 'in_progress' }),
    });

    await getSessionState('rec-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/api/apollo-hospitals/screening/sessions/rec-1/state'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects with the no-tenant marker and never calls fetch when the path has no segment', async () => {
    setPath('/');

    await expect(startSession('patient')).rejects.toMatchObject({
      status: 0,
      noTenant: true,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('lets VITE_API_BASE win over the path slug', async () => {
    vi.stubEnv('VITE_API_BASE', '/v1/api/baked-tenant/screening');
    setPath('/kemhrc');
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'rec-1', status: 'in_progress' }),
    });

    await startSession('patient');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/api/baked-tenant/screening/sessions'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
