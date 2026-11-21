import { database } from '../../backend/src/db/pool.ts';
import { claimConfirmation } from '../../backend/src/workers/confirmation.ts';

const connectionString = process.env.TEST_WORKER_DATABASE_URL;
if (!connectionString || !process.send) throw new Error('This helper requires an isolated test database and an IPC parent.');
const pool = database(connectionString);
const claim = await claimConfirmation(pool, 1500);
process.send(claim ?? { error: 'No confirmation job was claimable' });
setInterval(() => {}, 1000);
