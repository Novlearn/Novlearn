import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDatabaseUrl } from './local-database-url.mjs';
for (const value of [undefined, 'postgres://test:test@localhost:5432/test', 'postgresql://test:test@[::1]:5432/test']) {
  test(`allows loopback ${value ?? 'default'}`, () => assert.ok(localDatabaseUrl(value)));
}
for (const value of [
  'postgresql://postgres:secret@db.project.supabase.co/postgres',
  'postgresql://postgres:secret@127.0.0.1.remote.test/postgres',
  'postgresql://postgres:secret@192.168.1.2/postgres',
  'postgresql://postgres:secret@localhost/postgres?host=db.project.supabase.co',
  'https://localhost/postgres', 'invalid',
]) test(`rejects nonlocal/options ${value}`, () => assert.throws(() => localDatabaseUrl(value)));
