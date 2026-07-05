import type { AppSchema, FieldSchema } from '@nublox/schema-engine';
import type { ParsedCsv } from '@nublox/import-engine';

export type RecordValue = string | number | boolean | null;

export type GeneratedRecord = {
  id: string;
  appId: string;
  entityId: string;
  title: string;
  data: Record<string, RecordValue>;
  createdAt: string;
  updatedAt: string;
};

export type CreateRecordsInput = {
  csv: ParsedCsv;
  appSchema: AppSchema;
};

export type RecordSummary = {
  totalRecords: number;
  status?: {
    fieldName: string;
    values: Array<{
      label: string;
      count: number;
    }>;
  };
  overdue?: {
    fieldName: string;
    count: number;
  };
  money?: Array<{
    fieldName: string;
    label: string;
    total: number;
  }>;
};

export function createRecordsFromCsv(input: CreateRecordsInput): GeneratedRecord[] {
  const entity = input.appSchema.entities[0];

  if (!entity) {
    return [];
  }

  const titleField =
    entity.fields.find((field) => field.semanticRole === 'title') ??
    entity.fields.find((field) => field.type === 'text') ??
    entity.fields[0];

  return input.csv.rows.map((row, rowIndex) => {
    const data: Record<string, RecordValue> = {};

    for (const field of entity.fields) {
      const rawValue = row[field.position] ?? '';
      data[field.name] = coerceValue(rawValue, field);
    }

    const titleValue = titleField ? data[titleField.name] : null;

    return {
      id: `rec_${entity.id}_${rowIndex + 1}`,
      appId: input.appSchema.id,
      entityId: entity.id,
      title: stringifyValue(titleValue) || `Record ${rowIndex + 1}`,
      data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

export function summariseRecords(appSchema: AppSchema, records: GeneratedRecord[]): RecordSummary {
  const entity = appSchema.entities[0];

  if (!entity) {
    return {
      totalRecords: records.length
    };
  }

  const statusField = entity.fields.find((field) => field.semanticRole === 'status');
  const dueDateField = entity.fields.find((field) => field.semanticRole === 'due_date');
  const moneyFields = entity.fields.filter((field) => field.semanticRole === 'money');

  return {
    totalRecords: records.length,
    status: statusField
      ? {
          fieldName: statusField.name,
          values: summariseByField(records, statusField.name)
        }
      : undefined,
    overdue: dueDateField
      ? {
          fieldName: dueDateField.name,
          count: countOverdue(records, dueDateField.name, statusField?.name)
        }
      : undefined,
    money: moneyFields.map((field) => ({
      fieldName: field.name,
      label: field.label,
      total: sumNumberField(records, field.name)
    }))
  };
}

export function getRecordDisplayValue(record: GeneratedRecord, field: FieldSchema): string {
  return stringifyValue(record.data[field.name]);
}

function coerceValue(rawValue: string, field: FieldSchema): RecordValue {
  const value = rawValue.trim();

  if (value.length === 0) {
    return null;
  }

  if (field.type === 'number' || field.type === 'currency') {
    const cleaned = value.replace(/[£$,\s]/g, '');
    const number = Number(cleaned);
    return Number.isNaN(number) ? null : number;
  }

  if (field.type === 'boolean') {
    if (/^(true|yes|y|1)$/i.test(value)) return true;
    if (/^(false|no|n|0)$/i.test(value)) return false;
    return null;
  }

  return value;
}

function stringifyValue(value: RecordValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function summariseByField(
  records: GeneratedRecord[],
  fieldName: string
): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();

  for (const record of records) {
    const label = stringifyValue(record.data[fieldName]) || 'Blank';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function countOverdue(records: GeneratedRecord[], dueDateFieldName: string, statusFieldName?: string): number {
  const today = startOfDay(new Date());

  return records.filter((record) => {
    const dateValue = record.data[dueDateFieldName];

    if (typeof dateValue !== 'string') {
      return false;
    }

    const dueDate = startOfDay(new Date(dateValue));

    if (Number.isNaN(dueDate.getTime())) {
      return false;
    }

    const status = statusFieldName ? stringifyValue(record.data[statusFieldName]).toLowerCase() : '';

    if (['complete', 'completed', 'closed', 'done'].includes(status)) {
      return false;
    }

    return dueDate < today;
  }).length;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sumNumberField(records: GeneratedRecord[], fieldName: string): number {
  return records.reduce((total, record) => {
    const value = record.data[fieldName];
    return total + (typeof value === 'number' ? value : 0);
  }, 0);
}
