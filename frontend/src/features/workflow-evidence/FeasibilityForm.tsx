import { useState } from 'react';
import type { FormEvent } from 'react';
import { feasibilityInput, riskInput } from '../../../../shared/contracts/workflow-assessments.ts';
import type { FeasibilityInput } from '../../../../shared/contracts/workflow-assessments.ts';
import type { z } from 'zod';

const descriptions = {
  understanding: {
    objective: 'Workflow objective', observedSequence: 'Reviewed observed sequence', trigger: 'Trigger', inputs: 'Expected inputs',
    outputs: 'Expected outputs', businessRules: 'Business rules', humanJudgement: 'Human decision points',
    exceptions: 'Observed exceptions', systems: 'Systems involved',
  },
  integration: {
    source: 'Source integration', destination: 'Destination integration', method: 'Proposed integration method',
    identityRequirement: 'Required service identity', permissions: 'Permission requirements',
    contract: 'Expected data contract', mapping: 'Data mapping', throughput: 'Rate and throughput',
    failureHandling: 'Integration failure handling', reconciliation: 'Integration reconciliation',
  },
  execution: {
    checkpoints: 'Review checkpoints', idempotency: 'Idempotency', retry: 'Retry policy', successCriteria: 'Acceptance and success criteria',
    deduplication: 'Duplicate prevention', exceptions: 'Execution exception handling', recovery: 'Recovery requirements',
    escalation: 'Escalation', monitoring: 'Execution monitoring',
  },
  operations: {
    environment: 'Environment access', deploymentAssumptions: 'Deployment assumptions', monitoring: 'Operational monitoring',
    recoveryOwner: 'Recovery owner role', support: 'Operational support', retention: 'Data retention', securityBoundary: 'Security boundary',
    rollback: 'Rollback considerations',
  },
};

const labels = {
  determinism: 'Determinism', humanJudgement: 'Degree of human judgement', integrationComplexity: 'Integration complexity',
  dataSensitivity: 'Data sensitivity', failureImpact: 'Failure impact', recoverability: 'Recoverability', expectedValue: 'Expected value',
  implementationComplexity: 'Implementation complexity', maintenance: 'Ongoing maintenance',
};

export const value = (form: FormData, field: string) => String(form.get(field) ?? '').trim();
export const lines = (form: FormData, field: string) => value(form, field).split('\n').map(line => line.trim()).filter(Boolean);
const collect = (data: FormData, group: string, names: object) => Object.fromEntries(Object.keys(names).map(key => [key, value(data, group + '.' + key)]));
export const human = (input: string) => input.replaceAll('-', ' ');

export function Note({ name, label, initial, required = true }: {
  name: string; label: string; initial?: string; required?: boolean;
}) {
  return <label>{label}<textarea name={name} defaultValue={initial} minLength={required ? 5 : undefined}
    maxLength={required ? 600 : 4800} rows={2} required={required} /></label>;
}

function Select({ name, label, values, initial }: { name: string; label: string; values: readonly string[]; initial?: string }) {
  return <label>{label}<select name={name} required defaultValue={initial ?? ''}>
    <option value="" disabled>Select</option>
    {values.map(option => <option key={option} value={option}>{human(option)}</option>)}
  </select></label>;
}

type Risk = z.infer<typeof riskInput>;

export function FeasibilityForm({ initial, busy, save }: { initial: FeasibilityInput | null; busy: boolean; save: (input: FeasibilityInput) => void }) {
  const [dependencies, setDependencies] = useState(initial?.dependencies.length ?? 0);
  const [alt, setAlt] = useState(initial?.alternatives.kind ?? 'considered');
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = feasibilityInput.safeParse({
      understanding: { ...collect(data, 'understanding', descriptions.understanding), assumptions: lines(data, 'assumptions') },
      integration: { ...collect(data, 'integration', descriptions.integration),
        availability: value(data, 'availability'), authorization: value(data, 'authorization') },
      execution: { ...collect(data, 'execution', descriptions.execution), model: value(data, 'model') },
      operations: { ...collect(data, 'operations', descriptions.operations),
        clientApproval: value(data, 'clientApproval'), credentialAvailability: value(data, 'credentialAvailability') },
      alternatives: alt === 'considered' ? { kind: alt, option: value(data, 'alternativeOption'), tradeoff: value(data, 'tradeoff') }
        : { kind: alt, explanation: value(data, 'noAlternative') },
      dependencies: Array.from({ length: dependencies }, (_, i) => ({
        requirement: value(data, `dep${i}.requirement`), owner: value(data, `dep${i}.owner`),
        mandatory: value(data, `dep${i}.mandatory`) === 'mandatory', status: value(data, `dep${i}.status`), basis: value(data, `dep${i}.basis`),
      })),
      suitability: { ...collect(data, 'suitability', labels), basis: value(data, 'suitability.basis') },
      phases: lines(data, 'phases'),
    });
    if (!result.success) {
      setError(`Check ${result.error.issues[0].path.join(' / ')}. Use role slugs and enter one item per line for lists.`);
      return;
    }
    setError('');
    save(result.data);
  };
  const group = (key: keyof typeof descriptions) => {
    const values = initial?.[key] as Record<string, string> | undefined;
    return Object.entries(descriptions[key]).map(([field, label]) => field === 'recoveryOwner'
      ? <label key={field}>{label}<input name={`${key}.${field}`} pattern="[a-z][a-z0-9\-]{2,39}" defaultValue={values?.[field]} required /></label>
      : <Note key={field} name={`${key}.${field}`} label={label} initial={values?.[field]} />);
  };
  return <form onSubmit={submit}>
    <fieldset><legend>Workflow understanding</legend>{group('understanding')}
      <Note name="assumptions" label="Unresolved assumptions, one per line" required={false} initial={initial?.understanding.assumptions.join('\n')} />
    </fieldset>
    <fieldset><legend>Integration feasibility</legend>{group('integration')}
      <Select name="availability" label="Integration availability" initial={initial?.integration.availability}
        values={['verified-in-lab', 'assumed', 'requires-discovery', 'unavailable', 'not-applicable']} />
      <Select name="authorization" label="Permission and authorisation assumptions" initial={initial?.integration.authorization}
        values={['acknowledged', 'unresolved']} />
    </fieldset>
    <fieldset><legend>Execution design</legend>{group('execution')}
      <Select name="model" label="Execution model" initial={initial?.execution.model} values={['human-supervised', 'automated']} />
    </fieldset>
    <fieldset><legend>Operational feasibility</legend>{group('operations')}
      <Select name="clientApproval" label="External client approval" initial={initial?.operations.clientApproval} values={['required', 'not-required']} />
      <Select name="credentialAvailability" label="Credential availability" initial={initial?.operations.credentialAvailability}
        values={['verified-in-lab', 'unverified', 'not-applicable']} />
    </fieldset>
    <fieldset><legend>Alternatives and phases</legend>
      <label>Alternative assessment<select value={alt} onChange={event => setAlt(event.target.value as typeof alt)}>
        <option value="considered">Alternative considered</option><option value="none-viable">No viable alternative identified</option>
      </select></label>
      {alt === 'considered' ? <>
        <Note name="alternativeOption" label="Alternative approach" initial={initial?.alternatives.kind === 'considered' ? initial.alternatives.option : undefined} />
        <Note name="tradeoff" label="Alternative trade-offs" initial={initial?.alternatives.kind === 'considered' ? initial.alternatives.tradeoff : undefined} />
      </> : <Note name="noAlternative" label="Explain why there is no viable alternative"
        initial={initial?.alternatives.kind === 'none-viable' ? initial.alternatives.explanation : undefined} />}
      <Note name="phases" label="Implementation phases, one per line" initial={initial?.phases.join('\n')} />
    </fieldset>
    <fieldset><legend>Dependencies</legend>{Array.from({ length: dependencies }, (_, i) => {
      const prior = initial?.dependencies[i];
      return <fieldset key={i}><legend>Dependency {i + 1}</legend>
        <Note name={`dep${i}.requirement`} label="Dependency requirement" initial={prior?.requirement} />
        <label>Dependency owner role<input name={`dep${i}.owner`} pattern="[a-z][a-z0-9\-]{2,39}" defaultValue={prior?.owner} required /></label>
        <Select name={`dep${i}.mandatory`} label="Dependency priority" values={['mandatory', 'optional']}
          initial={prior ? prior.mandatory ? 'mandatory' : 'optional' : undefined} />
        <Select name={`dep${i}.status`} label="Dependency status" values={['verified-in-lab', 'unresolved']} initial={prior?.status} />
        <Note name={`dep${i}.basis`} label="Dependency evidence or assumption" initial={prior?.basis} />
      </fieldset>;
    })}
      <button type="button" disabled={dependencies === 12} onClick={() => setDependencies(n => n + 1)}>Add dependency</button>
      {dependencies > 0 && <button type="button" onClick={() => setDependencies(n => n - 1)}>Remove last dependency</button>}
    </fieldset>
    <fieldset><legend>Suitability inputs</legend>
      {Object.entries(labels).map(([key, label]) => <Select key={key} name={`suitability.${key}`} label={label}
        values={['low', 'medium', 'high']} initial={initial?.suitability[key as keyof typeof labels]} />)}
      <Note name="suitability.basis" label="Engineering basis for suitability" initial={initial?.suitability.basis} />
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy}>Save feasibility revision</button>
  </form>;
}

export function RiskForm({ initial, rationale, busy, save }: { initial: Risk[]; rationale: string | null; busy: boolean;
  save: (risks: Risk[], rationale: string) => void }) {
  const [count, setCount] = useState(initial.length);
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields = ['category', 'description', 'likelihood', 'impact', 'basis', 'mitigation', 'owner', 'residual', 'review'];
    const risks = riskInput.array().safeParse(Array.from({ length: count }, (_, i) =>
      collect(data, `risk${i}`, Object.fromEntries(fields.map(key => [key, true])))));
    if (!risks.success) {
      setError(`Check risk ${Number(risks.error.issues[0].path[0]) + 1} and its required fields.`);
      return;
    }
    setError('');
    save(risks.data, value(data, 'rationale'));
  };
  return <form onSubmit={submit}>
    <Note name="rationale" label="Risk review basis" initial={rationale ?? undefined} />
    {Array.from({ length: count }, (_, i) => {
      const risk = initial[i];
      const prefix = `risk${i}.`;
      return <fieldset key={i}><legend>Risk {i + 1}</legend>
        <Select name={prefix + 'category'} label="Risk category" initial={risk?.category}
          values={['security', 'privacy', 'reliability', 'compliance', 'operational', 'data-integrity']} />
        <Note name={prefix + 'description'} label="Risk description" initial={risk?.description} />
        <Select name={prefix + 'likelihood'} label="Likelihood" initial={risk?.likelihood} values={['low', 'medium', 'high']} />
        <Select name={prefix + 'impact'} label="Impact" initial={risk?.impact} values={['low', 'medium', 'high']} />
        <Note name={prefix + 'basis'} label="Risk evidence or assumption" initial={risk?.basis} />
        <Note name={prefix + 'mitigation'} label="Mitigation" initial={risk?.mitigation} />
        <label>Risk owner role<input name={prefix + 'owner'} defaultValue={risk?.owner} pattern="[a-z][a-z0-9\-]{2,39}" required /></label>
        <Select name={prefix + 'residual'} label="Residual risk" initial={risk?.residual} values={['low', 'medium', 'high']} />
        <Select name={prefix + 'review'} label="Risk review status" initial={risk?.review} values={['reviewed', 'unresolved']} />
      </fieldset>;
    })}
    <button type="button" disabled={count === 12} onClick={() => setCount(n => n + 1)}>Add risk</button>
    {count > 0 && <button type="button" onClick={() => setCount(n => n - 1)}>Remove last risk</button>}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy}>Save risk review</button>
  </form>;
}
