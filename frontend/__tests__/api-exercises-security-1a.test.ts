import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'caller', is_anonymous: false }, role: 'admin',
  authError: null as null | Error, profileError: null as null | Error,
  queries: [] as string[],
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: state.authError }) },
    from: (table: string) => {
      state.queries.push(table);
      const query = {
        select: () => query, or: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { role: state.role }, error: state.profileError }),
        single: async () => ({ data: { id: 1, content: { answer: 'private' } }, error: null }),
        order: async () => ({ data: [], error: null }),
      };
      return query;
    },
  }),
}));
import { GET } from '../app/api/exercises/route';

describe('Lot 1A GET privileged exercise access', () => {
  beforeEach(() => {
    state.user = { id: 'caller', is_anonymous: false }; state.role = 'admin';
    state.authError = null; state.profileError = null; state.queries = [];
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://unit.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  const request = (token = 'Bearer valid-token') => new Request('https://novlearn.test/api/exercises?id=1',
    { headers: { authorization: token } });
  it('rejects a verified anonymous Auth identity even if its profile claims admin', async () => {
    state.user.is_anonymous = true;
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(state.queries).toEqual([]);
  });
  it('rejects an invalid access token before any service-role data query', async () => {
    state.authError = new Error('invalid token');
    expect((await GET(request())).status).toBe(401);
    expect(state.queries).toEqual([]);
  });
  it('fails closed and hides internal database errors on role lookup failure', async () => {
    state.profileError = new Error('private database diagnostic');
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private database diagnostic');
    expect(state.queries).toEqual(['profiles']);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('does not query definitions for a non-admin', async () => {
    state.role = 'user';
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(state.queries).toEqual(['profiles']);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('marks the privileged response private and uncacheable', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Origin');
  });
});
