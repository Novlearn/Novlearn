// This test harness must never write to a distant Supabase/PostgreSQL server.
export function localDatabaseUrl(value = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres') {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid local database URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) {
    throw new Error('SQL integration tests accept only a literal loopback database URL without query options');
  }
  return url.href;
}
