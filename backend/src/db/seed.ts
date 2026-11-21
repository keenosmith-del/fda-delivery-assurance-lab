import { seedIntelligence } from '../../../database/seeds/intelligence.ts';
import { readConfig } from '../config/env.ts';
import { database } from './pool.ts';

const pool = database(readConfig().DATABASE_URL);
try {
  await seedIntelligence(pool);
  console.info('Synthetic workflow and endpoint fixtures are available.');
} finally {
  await pool.end();
}
