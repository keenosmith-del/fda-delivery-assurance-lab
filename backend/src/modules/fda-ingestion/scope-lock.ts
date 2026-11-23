import type { FdaScope } from '../../../../shared/contracts/fda-ingestion.ts';
import type { SqlClient } from '../../db/pool.ts';

// Keep canonical publication, operational decisions and approval in one scope order.
export async function lockFdaEvidence(db: SqlClient, scope: FdaScope) {
  await db.query('SELECT 1 FROM fda_sources WHERE tenant_id=$1 AND source_id=$2 FOR NO KEY UPDATE',
    [scope.tenantId, scope.sourceId]);
}
