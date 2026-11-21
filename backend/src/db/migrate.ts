import { readConfig } from '../config/env.ts';
import { migrate } from './migrations.ts';
import { database } from './pool.ts';

const config = readConfig('migration');
const pool = database(config.DATABASE_URL, config.databaseOptions);
try {
  await migrate(pool, config.MIGRATIONS_DIR);
  console.info('Database migrations are current.');
} finally {
  await pool.end();
}
