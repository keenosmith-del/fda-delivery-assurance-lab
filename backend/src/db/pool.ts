import { Pool } from 'pg';
import type { QueryResultRow } from 'pg';

export interface SqlClient {
  query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{
    rows: Row[];
    rowCount: number | null;
  }>;
}

export interface Database extends SqlClient {
  connect(): Promise<SqlClient & { release(error?: Error): void }>;
}

export function database(url: string, options: { max?: number; tls?: 'verify' | 'railway-private'; statementTimeoutMs?: number } = {}) {
  return new Pool({
    connectionString: url, max: options.max ?? 8, connectionTimeoutMillis: 3_000, idleTimeoutMillis: 30_000,
    statement_timeout: options.statementTimeoutMs ?? 8_000,
    ...(options.tls && { ssl: options.tls === 'verify' ? { rejectUnauthorized: true } : false }),
  });
}

export async function transaction<T>(pool: Database, work: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let rollbackError: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((failure: Error) => { rollbackError = failure; });
    throw error;
  } finally {
    client.release(rollbackError);
  }
}
