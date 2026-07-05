import type { AppSchema, EntitySchema, FieldSchema } from '@nublox/schema-engine';
import type { GeneratedRecord } from '@nublox/record-engine';
import type { AuditEvent } from '@nublox/audit-engine';

export type PersistenceSnapshot = {
  version: 1;
  capturedAt: string;
  app: AppSchema;
  records: GeneratedRecord[];
  auditEvents: AuditEvent[];
};

export type SavePersistenceSnapshotResult =
  | {
      ok: true;
      snapshot: PersistenceSnapshot;
      savedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

export type LoadPersistenceSnapshotResult =
  | {
      ok: true;
      snapshot: PersistenceSnapshot;
      loadedAt: string;
    }
  | {
      ok: false;
      error: string;
    };

export type ClearPersistenceSnapshotResult =
  | {
      ok: true;
      clearedAt: string;
      clearedCount: number;
    }
  | {
      ok: false;
      error: string;
    };

export type PersistenceAdapter = {
  saveSnapshot(snapshot: PersistenceSnapshot): Promise<SavePersistenceSnapshotResult>;
  loadLatestSnapshot(appId?: string): Promise<LoadPersistenceSnapshotResult>;
  clearSnapshots(appId?: string): Promise<ClearPersistenceSnapshotResult>;
};

export type CreatePersistenceSnapshotInput = {
  app: AppSchema;
  records: GeneratedRecord[];
  auditEvents: AuditEvent[];
  now?: Date;
};

export function createPersistenceSnapshot(input: CreatePersistenceSnapshotInput): PersistenceSnapshot {
  return {
    version: 1,
    capturedAt: (input.now ?? new Date()).toISOString(),
    app: input.app,
    records: input.records,
    auditEvents: input.auditEvents
  };
}

export function isPersistenceSnapshot(value: unknown): value is PersistenceSnapshot {
  if (!isObject(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.capturedAt !== 'string') return false;
  if (!isObject(value.app)) return false;
  if (!Array.isArray(value.records)) return false;
  if (!Array.isArray(value.auditEvents)) return false;
  return true;
}

export function generateMysqlBootstrapScript(snapshot: PersistenceSnapshot): string {
  return [
    '-- NuBlox Forge generated MySQL bootstrap script',
    `-- App: ${snapshot.app.name}`,
    `-- Captured: ${snapshot.capturedAt}`,
    '',
    'SET FOREIGN_KEY_CHECKS = 0;',
    generateMysqlSchemaSql(),
    generateMysqlDeleteSql(snapshot),
    generateMysqlInsertSql(snapshot),
    'SET FOREIGN_KEY_CHECKS = 1;',
    ''
  ].join('\n');
}

export function generateMysqlSchemaSql(): string {
  return `
CREATE TABLE IF NOT EXISTS nb_apps (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  captured_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nb_entities (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  app_id VARCHAR(191) NOT NULL,
  name VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  plural_label VARCHAR(255) NOT NULL,
  position INT NOT NULL,
  CONSTRAINT fk_nb_entities_app FOREIGN KEY (app_id) REFERENCES nb_apps(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nb_fields (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nb_records (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  app_id VARCHAR(191) NOT NULL,
  entity_id VARCHAR(191) NOT NULL,
  title VARCHAR(500) NOT NULL,
  data_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_nb_records_app FOREIGN KEY (app_id) REFERENCES nb_apps(id),
  CONSTRAINT fk_nb_records_entity FOREIGN KEY (entity_id) REFERENCES nb_entities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nb_audit_events (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`.trim();
}

function generateMysqlDeleteSql(snapshot: PersistenceSnapshot): string {
  return [
    `DELETE FROM nb_audit_events WHERE app_id = ${sqlString(snapshot.app.id)};`,
    `DELETE FROM nb_records WHERE app_id = ${sqlString(snapshot.app.id)};`,
    `DELETE FROM nb_fields WHERE entity_id IN (${snapshot.app.entities.map((entity) => sqlString(entity.id)).join(', ')});`,
    `DELETE FROM nb_entities WHERE app_id = ${sqlString(snapshot.app.id)};`,
    `DELETE FROM nb_apps WHERE id = ${sqlString(snapshot.app.id)};`,
    ''
  ].join('\n');
}

function generateMysqlInsertSql(snapshot: PersistenceSnapshot): string {
  const statements: string[] = [];

  statements.push(
    `INSERT INTO nb_apps (id, name, slug, captured_at) VALUES (${[
      sqlString(snapshot.app.id),
      sqlString(snapshot.app.name),
      sqlString(snapshot.app.slug),
      sqlDate(snapshot.capturedAt)
    ].join(', ')});`
  );

  snapshot.app.entities.forEach((entity, entityIndex) => {
    statements.push(entityInsertSql(entity, entityIndex));
    entity.fields.forEach((field) => statements.push(fieldInsertSql(field)));
  });

  snapshot.records.forEach((record) => {
    statements.push(
      `INSERT INTO nb_records (id, app_id, entity_id, title, data_json, created_at, updated_at) VALUES (${[
        sqlString(record.id),
        sqlString(record.appId),
        sqlString(record.entityId),
        sqlString(record.title),
        sqlJson(record.data),
        sqlDate(record.createdAt),
        sqlDate(record.updatedAt)
      ].join(', ')});`
    );
  });

  snapshot.auditEvents.forEach((event) => {
    statements.push(
      `INSERT INTO nb_audit_events (id, app_id, entity_id, record_id, record_title, action, actor, occurred_at, changes_json) VALUES (${[
        sqlString(event.id),
        sqlString(event.appId),
        sqlString(event.entityId),
        sqlString(event.recordId),
        sqlString(event.recordTitle),
        sqlString(event.action),
        sqlString(event.actor),
        sqlDate(event.occurredAt),
        sqlJson(event.changes)
      ].join(', ')});`
    );
  });

  return statements.join('\n');
}

function entityInsertSql(entity: EntitySchema, position: number): string {
  return `INSERT INTO nb_entities (id, app_id, name, label, plural_label, position) VALUES (${[
    sqlString(entity.id),
    sqlString(entity.appId),
    sqlString(entity.name),
    sqlString(entity.label),
    sqlString(entity.pluralLabel),
    String(position)
  ].join(', ')});`;
}

function fieldInsertSql(field: FieldSchema): string {
  return `INSERT INTO nb_fields (id, entity_id, name, label, field_type, is_required, is_unique, semantic_role, options_json, position) VALUES (${[
    sqlString(field.id),
    sqlString(field.entityId),
    sqlString(field.name),
    sqlString(field.label),
    sqlString(field.type),
    field.required ? '1' : '0',
    field.unique ? '1' : '0',
    field.semanticRole ? sqlString(field.semanticRole) : 'NULL',
    field.options ? sqlJson(field.options) : 'NULL',
    String(field.position)
  ].join(', ')});`;
}

function sqlDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return sqlString(value);
  }

  return sqlString(date.toISOString().slice(0, 23).replace('T', ' '));
}

function sqlJson(value: unknown): string {
  return `CAST(${sqlString(JSON.stringify(value))} AS JSON)`;
}

function sqlString(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\u0000/g, '')}'`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
