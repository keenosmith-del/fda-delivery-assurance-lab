import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';
import type { Database } from '../../backend/src/db/pool.ts';
import { migrate } from '../../backend/src/db/migrations.ts';

const migrations = fileURLToPath(new URL('../../database/migrations/', import.meta.url));

export async function openTestDatabase(directory = migrations): Promise<{ pool: Database; close: () => Promise<void>; connectionString: string | null }> {
  const nativeUrl = process.env.TEST_DATABASE_URL;
  if (nativeUrl) {
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: nativeUrl });
    const url = new URL(nativeUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    const connectionString = url.toString();
    const pool = new Pool({ connectionString });
    async function close() {
      await pool.end();
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    }
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await migrate(pool, directory);
      return { pool, close, connectionString };
    } catch (error) {
      await close();
      throw error;
    }
  }

  const db = await PGlite.create();
  let next = Promise.resolve();
  const pool: Database = {
    async connect() {
      const previous = next;
      let unlock!: () => void;
      next = new Promise(resolve => { unlock = resolve; });
      await previous;
      return {
        async query<Row extends QueryResultRow>(sql: string, values?: unknown[]) {
          const result = values ? await db.query<Row>(sql, values) : (await db.exec(sql))[0];
          return { rows: result.rows as Row[], rowCount: result.affectedRows || result.rows.length };
        },
        release: unlock,
      };
    },
    async query<Row extends QueryResultRow>(sql: string, values?: unknown[]) {
      const connection = await pool.connect();
      try {
        return await connection.query<Row>(sql, values);
      } finally {
        connection.release();
      }
    },
  };

  try {
    await migrate(pool, directory);
    return { pool, close: () => db.close(), connectionString: null };
  } catch (error) {
    await db.close();
    throw error;
  }
}
