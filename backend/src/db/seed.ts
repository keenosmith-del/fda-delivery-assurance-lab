import { seedIntelligence } from '../../../database/seeds/intelligence.ts';
import { seedMeasurement } from '../../../database/seeds/measurement.ts';
import { readConfig } from '../config/env.ts';
import { database } from './pool.ts';

const config = readConfig('seed');
const pool = database(config.DATABASE_URL, config.databaseOptions);
try {
  await seedIntelligence(pool);
  await seedMeasurement(pool);
  console.info('Synthetic workflow, endpoint and measurement fixtures are available.');
} finally {
  await pool.end();
}
