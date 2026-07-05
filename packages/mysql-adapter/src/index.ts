import type { AppSchema, EntitySchema, FieldSchema } from '@nublox/schema-engine';
import type { GeneratedRecord } from '@nublox/record-engine';
import type { AuditEvent } from '@nublox/audit-engine';
import {
  isPersistenceSnapshot,
  type ClearPersistenceSnapshotResult,
  type LoadPersistenceSnapshotResult,
  type PersistenceAdapter,
  type PersistenceSnapshot,
  type SavePersistenceSnapshotResult
} from '@nublox/persistence-engine';

export type SqlValue = string | number | boolean | null;
export type SqlRow = Record<string, unknown>;

export type SqlExecutionResult<T extends SqlRow = SqlRow> = {
  rows: T[];
  affectedRows?: number;
};

export type SqlExecutor = {
  query<T extends SqlRow = SqlRow>(sql: string, values?: SqlValue[]): Promise<SqlExecutionResult<T>>;
  transaction?<T>(work: (executor: SqlExecutor) => Promise<T>): Promise<T>;
};

export type MysqlPersistenceAdapterOptions = {
  ensureSchema?: boolean;
};

export function createMysqlPersistenceAdapter(
  executor: SqlExecutor,
  options: MysqlPersistenceAdapterOptions = {}
): PersistenceAdapter {
  const ensureSchema = options.ensureSchema ?? true;

  return {
    async saveSnapshot(snapshot: PersistenceSnapshot): Promise<SavePersistenceSnapshotResult> {
      if (!isPersistenceSnapshot(snapshot)) {
        return {
          ok: false,
          error: 'Invalid persistence snapshot.'
        };
      }

      try {
        await runInTransaction(executor, async (db) => {
          if (ensureSchema) {
            for (const statement of createMysqlSchemaStatements()) {
              await db.query(statement.sql, statement.values);
            }
          }

          for (const statement of createSaveSnapshotStatements(snapshot)) {
            await db.query(statement.sql, statement.values);
          }
        });

        return {
          ok: true,
          snapshot,
          savedAt: new Date().toISOString()
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to save MySQL snapshot.'
        };
      }
    },

    async loadLatestSnapshot(appId?: string): Promise<LoadPersistenceSnapshotResult> {
      try {
        const snapshot = await loadSnapshot(executor, appId);

        if (!snapshot) {
          return {
            ok: false,
            error: appId ? `No snapshot found for app ${appId}.` : 'No snapshots have been saved.'
          };
        }

        return {
          ok: true,
          snapshot,
          loadedAt: new Date().toISOString()
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to load MySQL snapshot.'
        };
      }
    },

    async clearSnapshots(appId?: string): Promise<ClearPersistenceSnapshotResult> {
      try {
        const statements = appId ? createDeleteAppStatements(appId) : createClearAllStatements();
        let clearedCount = 0;

        await runInTransaction(executor, async (db) => {
          for (const statement of statements) {
            const result = await db.query(statement.sql, statement.values);
            clearedCount += result.affectedRows ?? 0;
          }
        });

        return {
          ok: true,
          clearedAt: new Date().toISOString(),
          clearedCount
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to clear MySQL snapshots.'
        };
      }
    }
  };
}

export type SqlStatement = {
  sql: string;
  values: SqlValue[];
};

export function createMysqlSchemaStatements(): SqlStatement[] {
  return [
    {
      sql: `CREATE TABLE IF NOT EXISTS nb_apps (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL,
        captured_at DATETIME(3) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      values: []
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS nb_entities (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        app_id VARCHAR(191) NOT NULL,
        name VARCHAR(255) NOT NULL,
        label VARCHAR(255) NOT NULL,
        plural_label VARCHAR(255) NOT NULL,
        position INT NOT NULL,
        CONSTRAINT fk_nb_entities_app FOREIGN KEY (app_id) REFERENCES nb_apps(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      values: []
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS nb_fields (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        entity_id VARCHAR(191) NOT NULL,
        name VARCHAR(255) NOT NULL,
        label VARCHAR(255) NOT NULL,
        field_type VARCHAR(64) NOT NULL,
        is_required TINYINT(1) NOT NULL,
        is_unique TINYINT(1) NOT NULL,
        semantic_role VARCHAR(64) NULL,
        options_json JSON NULL,
        position INT NOT NULL,
        CONSTRAINT fk_nb_fields_entity FOREIGN KEY (entity_id) REFERENCES nb_entities(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      values: []
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS nb_records (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        app_id VARCHAR(191) NOT NULL,
        entity_id VARCHAR(191) NOT NULL,
        title VARCHAR(500) NOT NULL,
        data_json JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        CONSTRAINT fk_nb_records_app FOREIGN KEY (app_id) REFERENCES nb_apps(id),
        CONSTRAINT fk_nb_records_entity FOREIGN KEY (entity_id) REFERENCES nb_entities(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      values: []
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS nb_audit_events (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        app_id VARCHAR(191) NOT NULL,
        entity_id VARCHAR(191) NOT NULL,
        record_id VARCHAR(191) NOT NULL,
        record_title VARCHAR(500) NOT NULL,
        action VARCHAR(64) NOT NULL,
        actor VARCHAR(255) NOT NULL,
        occurred_at DATETIME(3) NOT NULL,
        changes_json JSON NOT NULL,
        CONSTRAINT fk_nb_audit_events_app FOREIGN KEY (app_id) REFERENCES nb_apps(id),
        CONSTRAINT fk_nb_audit_events_entity FOREIGN KEY (entity_id) REFERENCES nb_entities(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      values: []
    }
  ];
}

export function createSaveSnapshotStatements(snapshot: PersistenceSnapshot): SqlStatement[] {
  const statements: SqlStatement[] = [];

  statements.push(...createDeleteAppStatements(snapshot.app.id));

  statements.push({
    sql: 'INSERT INTO nb_apps (id, name, slug, captured_at) VALUES (?, ?, ?, ?)',
    values: [snapshot.app.id, snapshot.app.name, snapshot.app.slug, toMysqlDate(snapshot.capturedAt)]
  });

  snapshot.app.entities.forEach((entity, entityIndex) => {
    statements.push({
      sql: 'INSERT INTO nb_entities (id, app_id, name, label, plural_label, position) VALUES (?, ?, ?, ?, ?, ?)',
      values: [entity.id, entity.appId, entity.name, entity.label, entity.pluralLabel, entityIndex]
    });

    for (const field of entity.fields) {
      statements.push({
        sql: 'INSERT INTO nb_fields (id, entity_id, name, label, field_type, is_required, is_unique, semantic_role, options_json, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)',
        values: [
          field.id,
          field.entityId,
          field.name,
          field.label,
          field.type,
          field.required ? 1 : 0,
          field.unique ? 1 : 0,
          field.semanticRole ?? null,
          JSON.stringify(field.options ?? null),
          field.position
        ]
      });
    }
  });

  for (const record of snapshot.records) {
    statements.push({
      sql: 'INSERT INTO nb_records (id, app_id, entity_id, title, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?, ?)',
      values: [
        record.id,
        record.appId,
        record.entityId,
        record.title,
        JSON.stringify(record.data),
        toMysqlDate(record.createdAt),
        toMysqlDate(record.updatedAt)
      ]
    });
  }

  for (const event of snapshot.auditEvents) {
    statements.push({
      sql: 'INSERT INTO nb_audit_events (id, app_id, entity_id, record_id, record_title, action, actor, occurred_at, changes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))',
      values: [
        event.id,
        event.appId,
        event.entityId,
        event.recordId,
        event.recordTitle,
        event.action,
        event.actor,
        toMysqlDate(event.occurredAt),
        JSON.stringify(event.changes)
      ]
    });
  }

  return statements;
}

export function createDeleteAppStatements(appId: string): SqlStatement[] {
  return [
    { sql: 'DELETE FROM nb_audit_events WHERE app_id = ?', values: [appId] },
    { sql: 'DELETE FROM nb_records WHERE app_id = ?', values: [appId] },
    { sql: 'DELETE FROM nb_fields WHERE entity_id IN (SELECT id FROM nb_entities WHERE app_id = ?)', values: [appId] },
    { sql: 'DELETE FROM nb_entities WHERE app_id = ?', values: [appId] },
    { sql: 'DELETE FROM nb_apps WHERE id = ?', values: [appId] }
  ];
}

export function createClearAllStatements(): SqlStatement[] {
  return [
    { sql: 'DELETE FROM nb_audit_events', values: [] },
    { sql: 'DELETE FROM nb_records', values: [] },
    { sql: 'DELETE FROM nb_fields', values: [] },
    { sql: 'DELETE FROM nb_entities', values: [] },
    { sql: 'DELETE FROM nb_apps', values: [] }
  ];
}

async function loadSnapshot(executor: SqlExecutor, appId?: string): Promise<PersistenceSnapshot | null> {
  const appResult = appId
    ? await executor.query('SELECT id, name, slug, captured_at FROM nb_apps WHERE id = ? LIMIT 1', [appId])
    : await executor.query('SELECT id, name, slug, captured_at FROM nb_apps ORDER BY captured_at DESC LIMIT 1');

  const appRow = appResult.rows[0];
  if (!appRow) return null;

  const resolvedAppId = toStringValue(appRow.id);
  const entityResult = await executor.query('SELECT id, app_id, name, label, plural_label, position FROM nb_entities WHERE app_id = ? ORDER BY position ASC', [resolvedAppId]);
  const entityRows = entityResult.rows;
  const entityIds = entityRows.map((row) => toStringValue(row.id));
  const fieldRows = entityIds.length > 0
    ? (await executor.query(`SELECT id, entity_id, name, label, field_type, is_required, is_unique, semantic_role, options_json, position FROM nb_fields WHERE entity_id IN (${placeholders(entityIds.length)}) ORDER BY position ASC`, entityIds)).rows
    : [];
  const recordRows = (await executor.query('SELECT id, app_id, entity_id, title, data_json, created_at, updated_at FROM nb_records WHERE app_id = ? ORDER BY created_at ASC, id ASC', [resolvedAppId])).rows;
  const auditRows = (await executor.query('SELECT id, app_id, entity_id, record_id, record_title, action, actor, occurred_at, changes_json FROM nb_audit_events WHERE app_id = ? ORDER BY occurred_at DESC, id DESC', [resolvedAppId])).rows;

  const entities: EntitySchema[] = entityRows.map((row) => {
    const entityId = toStringValue(row.id);
    return {
      id: entityId,
      appId: toStringValue(row.app_id),
      name: toStringValue(row.name),
      label: toStringValue(row.label),
      pluralLabel: toStringValue(row.plural_label),
      fields: fieldRows.filter((fieldRow) => toStringValue(fieldRow.entity_id) === entityId).map(rowToField)
    };
  });

  const app: AppSchema = {
    id: resolvedAppId,
    name: toStringValue(appRow.name),
    slug: toStringValue(appRow.slug),
    entities
  };

  return {
    version: 1,
    capturedAt: fromMysqlDate(appRow.captured_at),
    app,
    records: recordRows.map(rowToRecord),
    auditEvents: auditRows.map(rowToAuditEvent)
  };
}

function rowToField(row: SqlRow): FieldSchema {
  const field: FieldSchema = {
    id: toStringValue(row.id),
    entityId: toStringValue(row.entity_id),
    name: toStringValue(row.name),
    label: toStringValue(row.label),
    type: toStringValue(row.field_type) as FieldSchema['type'],
    required: toBooleanValue(row.is_required),
    unique: toBooleanValue(row.is_unique),
    position: toNumberValue(row.position)
  };

  const semanticRole = nullableString(row.semantic_role);
  if (semanticRole) field.semanticRole = semanticRole as FieldSchema['semanticRole'];

  const options = parseJson(row.options_json);
  if (Array.isArray(options)) field.options = options.map((option) => String(option));

  return field;
}

function rowToRecord(row: SqlRow): GeneratedRecord {
  return {
    id: toStringValue(row.id),
    appId: toStringValue(row.app_id),
    entityId: toStringValue(row.entity_id),
    title: toStringValue(row.title),
    data: parseJsonObject(row.data_json),
    createdAt: fromMysqlDate(row.created_at),
    updatedAt: fromMysqlDate(row.updated_at)
  };
}

function rowToAuditEvent(row: SqlRow): AuditEvent {
  const changes = parseJson(row.changes_json);

  return {
    id: toStringValue(row.id),
    appId: toStringValue(row.app_id),
    entityId: toStringValue(row.entity_id),
    recordId: toStringValue(row.record_id),
    recordTitle: toStringValue(row.record_title),
    action: toStringValue(row.action) as AuditEvent['action'],
    actor: toStringValue(row.actor),
    occurredAt: fromMysqlDate(row.occurred_at),
    changes: Array.isArray(changes) ? changes as AuditEvent['changes'] : []
  };
}

async function runInTransaction<T>(executor: SqlExecutor, work: (executor: SqlExecutor) => Promise<T>): Promise<T> {
  if (executor.transaction) {
    return executor.transaction(work);
  }

  return work(executor);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function toMysqlDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function fromMysqlDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const asString = toStringValue(value);
  const date = new Date(asString);
  return Number.isNaN(date.getTime()) ? asString : date.toISOString();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonObject(value: unknown): GeneratedRecord['data'] {
  const parsed = parseJson(value);

  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    return parsed as GeneratedRecord['data'];
  }

  return {};
}

function toStringValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return '';
  return String(value);
}

function nullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}

function toNumberValue(value: unknown): number {
  const number = Number(value);
  return Number.isNaN(number) ? 0 : number;
}

function toBooleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}
