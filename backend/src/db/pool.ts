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

export function database(url: string) {
  return new Pool({ connectionString: url, connectionTimeoutMillis: 3_000, max: 8 });
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
