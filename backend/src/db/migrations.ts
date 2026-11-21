import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database, SqlClient } from './pool.ts';
import { transaction } from './pool.ts';

export async function loadMigrations(directory: string) {
  const names = (await readdir(directory)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  if (!names.length || new Set(names.map(name => name.slice(0, 3))).size !== names.length) {
    throw new Error('Migration directory requires unique version prefixes.');
  }
  return Promise.all(names.map(async name => {
    const sql = await readFile(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

async function applied(client: SqlClient) {
  const result = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
  return new Map(result.rows.map(entry => [entry.name, entry.checksum]));
}

export async function migrationsReady(client: SqlClient, expected: Awaited<ReturnType<typeof loadMigrations>>) {
  const versions = await applied(client);
  return expected.every(entry => versions.get(entry.name) === entry.checksum);
}

export async function migrate(pool: Database, directory: string) {
  const files = await loadMigrations(directory);
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(731820001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const versions = await applied(client);
    for (const { name, checksum, sql } of files) {
      if (versions.has(name)) {
        if (versions.get(name) !== checksum) throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
    }
  });
}
