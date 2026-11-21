import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './pool.ts';
import { transaction } from './pool.ts';

export async function migrate(pool: Database, directory: string) {
  const names = (await readdir(directory)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(731820001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of names) {
      const sql = await readFile(join(directory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query<{checksum: string}>('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (previous.rowCount) {
        if (previous.rows[0].checksum !== checksum) throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
    }
  });
}
