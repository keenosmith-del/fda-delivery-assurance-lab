import { seedIntelligence } from '../../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../../database/seeds/measurement.ts';
import { readConfig } from '../config/env.ts';
import { database } from './pool.ts';

const pool = database(readConfig().DATABASE_URL);
try {
  await seedIntelligence(pool);
  await seedMeasurement(pool);
  console.info('Synthetic workflow, endpoint and measurement fixtures are available.');
} finally {
  await pool.end();
}
