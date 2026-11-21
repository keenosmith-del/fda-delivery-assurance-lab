import type { FastifyReply } from 'fastify';

export const sourceRevision = (value: string | undefined) =>
  value && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;

export type EvidenceActor = {
  role: 'operator' | 'demo' | 'local-token' | 'local-open';
  sourceRevision: string | null;
};

export type ExportContext = {
  mode: 'local' | 'test' | 'staging' | 'production';
  revision: string | null;
};

export function evidenceDownload<T>(reply: FastifyReply, filename: string, context: ExportContext,
  evidenceType: string, calculationVersion: string | null, evidence: T) {
  reply.header('content-disposition', `attachment; filename="${filename}.json"`);
  return {
    ...evidence,
    evidenceType,
    schemaVersion: 'fda-evidence/v1',
    calculationVersion,
    sourceRevision: context.revision,
    environment: context.mode,
  };
}
