import type { Id } from '@nublox/core';

export type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'currency'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'email'
  | 'url';

export type FieldSemanticRole =
  | 'title'
  | 'status'
  | 'owner'
  | 'due_date'
  | 'created_date'
  | 'updated_date'
  | 'money'
  | 'risk'
  | 'identifier';

export type AppSchema = {
  id: Id;
  name: string;
  slug: string;
  entities: EntitySchema[];
};

export type EntitySchema = {
  id: Id;
  appId: Id;
  name: string;
  label: string;
  pluralLabel: string;
  fields: FieldSchema[];
};

export type FieldSchema = {
  id: Id;
  entityId: Id;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  semanticRole?: FieldSemanticRole;
  options?: string[];
  position: number;
};

export type ViewType = 'list' | 'detail' | 'form' | 'dashboard' | 'kanban' | 'audit';

export type AppView = {
  id: Id;
  entityId: Id;
  name: string;
  label: string;
  type: ViewType;
  config: Record<string, unknown>;
};
