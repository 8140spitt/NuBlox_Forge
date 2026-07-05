import type { GeneratedRecord, RecordValue } from '@nublox/record-engine';

export type AuditAction = 'record.created' | 'record.updated' | 'record.deleted';

export type AuditChange = {
  fieldName: string;
  label: string;
  before: RecordValue;
  after: RecordValue;
};

export type AuditEvent = {
  id: string;
  appId: string;
  entityId: string;
  recordId: string;
  recordTitle: string;
  action: AuditAction;
  actor: string;
  occurredAt: string;
  changes: AuditChange[];
};

export type CreateUpdateAuditEventInput = {
  before: GeneratedRecord;
  after: GeneratedRecord;
  labelsByFieldName: Record<string, string>;
  actor?: string;
  now?: Date;
};

export function createUpdateAuditEvent(input: CreateUpdateAuditEventInput): AuditEvent | null {
  const changes: AuditChange[] = [];

  for (const [fieldName, afterValue] of Object.entries(input.after.data)) {
    const beforeValue = input.before.data[fieldName] ?? null;

    if (normaliseComparable(beforeValue) === normaliseComparable(afterValue)) {
      continue;
    }

    changes.push({
      fieldName,
      label: input.labelsByFieldName[fieldName] ?? fieldName,
      before: beforeValue,
      after: afterValue
    });
  }

  if (changes.length === 0) {
    return null;
  }

  const occurredAt = (input.now ?? new Date()).toISOString();

  return {
    id: `aud_${occurredAt.replace(/[^0-9]/g, '')}_${Math.random().toString(36).slice(2, 8)}`,
    appId: input.after.appId,
    entityId: input.after.entityId,
    recordId: input.after.id,
    recordTitle: input.after.title,
    action: 'record.updated',
    actor: input.actor ?? 'Local user',
    occurredAt,
    changes
  };
}

export function formatAuditValue(value: RecordValue): string {
  if (value === null) return 'Blank';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function normaliseComparable(value: RecordValue): string {
  if (value === null) return '';
  return String(value);
}
