import { createId, normaliseName, titleCase } from '@nublox/core';
import type { AppSchema, FieldSchema, FieldType, FieldSemanticRole } from '@nublox/schema-engine';

export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

export type ColumnAnalysis = {
  originalName: string;
  normalisedName: string;
  detectedType: FieldType;
  semanticRole?: FieldSemanticRole;
  completeness: number;
  uniqueValueCount: number;
  sampleValues: string[];
  options?: string[];
};

export type ImportAnalysis = {
  rowCount: number;
  columns: ColumnAnalysis[];
  warnings: string[];
};

export type GenerateAppSchemaInput = {
  appName: string;
  importAnalysis: ImportAnalysis;
};

export function parseCsv(input: string): ParsedCsv {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === ',' && !insideQuotes) {
      row.push(current.trim());
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      row.push(current.trim());
      current = '';

      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  row.push(current.trim());

  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;

  return {
    headers: headers.map((header, index) => header || `Column ${index + 1}`),
    rows: dataRows
  };
}

export function analyseCsv(csv: ParsedCsv): ImportAnalysis {
  const warnings: string[] = [];

  if (csv.headers.length === 0) {
    return {
      rowCount: 0,
      columns: [],
      warnings: ['No headers were detected.']
    };
  }

  const columns = csv.headers.map((header, columnIndex): ColumnAnalysis => {
    const values = csv.rows
      .map((row) => row[columnIndex] ?? '')
      .map((value) => value.trim());

    const nonEmpty = values.filter(Boolean);
    const uniqueValues = [...new Set(nonEmpty)];
    const detectedType = detectFieldType(header, nonEmpty);
    const semanticRole = detectSemanticRole(header, detectedType, uniqueValues);
    const options = detectedType === 'select' ? uniqueValues.slice(0, 30) : undefined;

    return {
      originalName: header,
      normalisedName: normaliseName(header),
      detectedType,
      semanticRole,
      completeness: csv.rows.length === 0 ? 0 : nonEmpty.length / csv.rows.length,
      uniqueValueCount: uniqueValues.length,
      sampleValues: uniqueValues.slice(0, 5),
      options
    };
  });

  const duplicateNames = findDuplicates(columns.map((column) => column.normalisedName));
  for (const name of duplicateNames) {
    warnings.push(`Duplicate column name after normalisation: ${name}`);
  }

  if (!columns.some((column) => column.semanticRole === 'title')) {
    warnings.push('No title field was detected. The first text field will be used as the record title.');
  }

  return {
    rowCount: csv.rows.length,
    columns,
    warnings
  };
}

export function generateAppSchemaFromImport(input: GenerateAppSchemaInput): AppSchema {
  const appId = createId('app');
  const entityId = createId('ent');
  const slug = normaliseName(input.appName);

  const fields = input.importAnalysis.columns.map((column, position): FieldSchema => ({
    id: createId('fld'),
    entityId,
    name: column.normalisedName,
    label: titleCase(column.originalName),
    type: column.detectedType,
    required: column.completeness >= 0.98,
    unique: column.uniqueValueCount === input.importAnalysis.rowCount && input.importAnalysis.rowCount > 0,
    semanticRole: column.semanticRole,
    options: column.options,
    position
  }));

  ensureTitleField(fields);

  return {
    id: appId,
    name: input.appName.trim() || 'Generated App',
    slug,
    entities: [
      {
        id: entityId,
        appId,
        name: inferEntityName(input.appName),
        label: titleCase(inferEntityName(input.appName)),
        pluralLabel: titleCase(inferEntityName(input.appName)) + 's',
        fields
      }
    ]
  };
}

function detectFieldType(header: string, values: string[]): FieldType {
  const name = normaliseName(header);

  if (values.length === 0) return 'text';
  if (name.includes('email')) return 'email';
  if (name.includes('url') || name.includes('link')) return 'url';
  if (name.includes('date') || name.endsWith('_at')) return 'date';
  if (name.includes('cost') || name.includes('price') || name.includes('budget') || name.includes('value') || name.includes('amount')) {
    return 'currency';
  }

  const booleanLike = values.every((value) => /^(true|false|yes|no|y|n|0|1)$/i.test(value));
  if (booleanLike) return 'boolean';

  const dateLike = values.every((value) => !Number.isNaN(Date.parse(value)));
  if (dateLike) return 'date';

  const numberLike = values.every((value) => {
    const cleaned = value.replace(/[£$,\s]/g, '');
    return cleaned.length > 0 && !Number.isNaN(Number(cleaned));
  });
  if (numberLike) return 'number';

  const uniqueRatio = new Set(values).size / values.length;
  if (values.length >= 3 && uniqueRatio <= 0.5) return 'select';

  const longText = values.some((value) => value.length > 120);
  return longText ? 'long_text' : 'text';
}

function detectSemanticRole(
  header: string,
  type: FieldType,
  uniqueValues: string[]
): FieldSemanticRole | undefined {
  const name = normaliseName(header);

  if (name === 'id' || name.endsWith('_id') || name.includes('identifier')) return 'identifier';
  if (name.includes('status') || name.includes('stage')) return 'status';
  if (name.includes('owner') || name.includes('assignee') || name.includes('responsible')) return 'owner';
  if (name.includes('due') && type === 'date') return 'due_date';
  if (name.includes('created') && type === 'date') return 'created_date';
  if (name.includes('updated') && type === 'date') return 'updated_date';
  if (name.includes('risk')) return 'risk';
  if (type === 'currency') return 'money';

  const titleNames = ['name', 'title', 'project_name', 'task_name', 'summary'];
  if (titleNames.includes(name)) return 'title';

  if (uniqueValues.length > 0 && uniqueValues.every((value) => value.length < 90) && type === 'text') {
    return undefined;
  }

  return undefined;
}

function ensureTitleField(fields: FieldSchema[]): void {
  if (fields.some((field) => field.semanticRole === 'title')) {
    return;
  }

  const firstTextField = fields.find((field) => field.type === 'text' || field.type === 'long_text');
  if (firstTextField) {
    firstTextField.semanticRole = 'title';
  }
}

function inferEntityName(appName: string): string {
  const name = normaliseName(appName);

  if (name.includes('project')) return 'project';
  if (name.includes('action')) return 'action';
  if (name.includes('risk')) return 'risk';
  if (name.includes('asset')) return 'asset';
  if (name.includes('issue')) return 'issue';

  return 'record';
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }

  return [...duplicates];
}
