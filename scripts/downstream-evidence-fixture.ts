import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Database } from '../backend/src/db/pool.ts';
import { controlOperation, operationEvidence, startOperation } from '../backend/src/modules/downstream/operations.ts';
import { claimOperation, processClaim } from '../backend/src/modules/downstream/worker.ts';
import type { Fault } from '../backend/src/modules/downstream/simulator.ts';
import { immediatePolicy, injectedSimulator } from '../tests/support/downstream-harness.ts';
import { fixtureScope } from './fda-fixture.ts';

export async function exerciseDownstreamEvidence(pool: Database, caseId: string, fault: Fault) {
  const simulator = await injectedSimulator(fault);
  const actor = { role: 'local-open', sourceRevision: process.env.LAB_SOURCE_REVISION ?? null } as const;
  const policy = { ...immediatePolicy, revision: actor.sourceRevision, maxDispatches: fault === 'pre-commit' ? 1 : 3 };
  const reason = 'Authorised scoped synthetic execution for independently reviewable lab evidence.';
  try {
    const op = await startOperation(pool, fixtureScope, caseId,
      { requestKey: randomUUID(), syntheticOnly: true, supervisionConfirmed: false, reason }, actor);
    async function runPending() {
      for (let i = 0; i < 10; i++) {
        const claim = await claimOperation(pool, policy);
        if (!claim) return;
        assert.equal(claim.operation.id, op.id);
        assert(await processClaim(pool, claim, simulator.adapter, policy));
      }
      throw new Error('The synthetic evidence exercise did not settle.');
    }
    await runPending();
    if (fault === 'pre-commit') {
      assert.equal((await operationEvidence(pool, fixtureScope, op.id)).operation.state, 'failed-terminal');
      await controlOperation(pool, fixtureScope, op.id, { action: 'redrive', reason }, actor);
      await runPending();
    }
    const evidence = await operationEvidence(pool, fixtureScope, op.id);
    assert.equal(evidence.operation.state, 'succeeded');
    assert.equal((await simulator.storage.pool.query('SELECT effect_id FROM synthetic_effects WHERE key=$1', [op.effect_key])).rows.length, 1);
    return evidence;
  } finally {
    await simulator.close();
  }
}
