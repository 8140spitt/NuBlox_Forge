import { createId, normaliseName } from '@nublox/core';
import type { AppSchema, EntitySchema, AppView } from '@nublox/schema-engine';

export type CommandManifest = {
  id: string;
  identifier: string;
  label: string;
  category: string;
  entityId?: string;
};

export type MenuManifest = {
  id: string;
  label: string;
  items: Array<{
    id: string;
    label: string;
    commandIdentifier: string;
  }>;
};

export type PerspectiveManifest = {
  id: string;
  name: string;
  label: string;
  views: Array<{
    viewId: string;
    region: 'left' | 'center' | 'right' | 'bottom' | 'top';
    ratio: number;
  }>;
};

export type RichClientManifest = {
  appId: string;
  commands: CommandManifest[];
  views: AppView[];
  menus: MenuManifest[];
  perspectives: PerspectiveManifest[];
};

export function createRichClientManifest(app: AppSchema): RichClientManifest {
  const entity = app.entities[0];

  if (!entity) {
    return {
      appId: app.id,
      commands: [],
      views: [],
      menus: [],
      perspectives: []
    };
  }

  const views = createViews(entity);
  const commands = createCommands(app, entity);
  const menus = createMenus(entity, commands);
  const perspectives = createPerspectives(entity, views);

  return {
    appId: app.id,
    commands,
    views,
    menus,
    perspectives
  };
}

function createCommands(app: AppSchema, entity: EntitySchema): CommandManifest[] {
  const base = `app.${normaliseName(app.name)}.${entity.name}`;

  return [
    {
      id: createId('cmd'),
      identifier: `${base}.create`,
      label: `Create ${entity.label}`,
      category: entity.label,
      entityId: entity.id
    },
    {
      id: createId('cmd'),
      identifier: `${base}.edit`,
      label: `Edit ${entity.label}`,
      category: entity.label,
      entityId: entity.id
    },
    {
      id: createId('cmd'),
      identifier: `${base}.delete`,
      label: `Delete ${entity.label}`,
      category: entity.label,
      entityId: entity.id
    },
    {
      id: createId('cmd'),
      identifier: `${base}.export`,
      label: `Export ${entity.pluralLabel}`,
      category: 'Reporting',
      entityId: entity.id
    },
    {
      id: createId('cmd'),
      identifier: `${base}.refresh`,
      label: 'Refresh',
      category: 'System',
      entityId: entity.id
    }
  ];
}

function createViews(entity: EntitySchema): AppView[] {
  const statusField = entity.fields.find((field) => field.semanticRole === 'status');

  const views: AppView[] = [
    {
      id: createId('view'),
      entityId: entity.id,
      name: `${entity.name}_list`,
      label: `${entity.pluralLabel} List`,
      type: 'list',
      config: {
        fields: entity.fields.slice(0, 8).map((field) => field.name)
      }
    },
    {
      id: createId('view'),
      entityId: entity.id,
      name: `${entity.name}_detail`,
      label: `${entity.label} Detail`,
      type: 'detail',
      config: {
        fields: entity.fields.map((field) => field.name)
      }
    },
    {
      id: createId('view'),
      entityId: entity.id,
      name: `${entity.name}_form`,
      label: `${entity.label} Form`,
      type: 'form',
      config: {
        fields: entity.fields.map((field) => field.name)
      }
    },
    {
      id: createId('view'),
      entityId: entity.id,
      name: `${entity.name}_dashboard`,
      label: `${entity.label} Dashboard`,
      type: 'dashboard',
      config: {
        metrics: [
          { type: 'count', label: `Total ${entity.pluralLabel}` },
          ...(statusField ? [{ type: 'group_by', field: statusField.name, label: 'By Status' }] : [])
        ]
      }
    },
    {
      id: createId('view'),
      entityId: entity.id,
      name: `${entity.name}_audit`,
      label: `${entity.label} Audit Trail`,
      type: 'audit',
      config: {}
    }
  ];

  if (statusField) {
    views.push({
      id: createId('view'),
      entityId: entity.id,
      name: `${entity.name}_board`,
      label: `${entity.label} Board`,
      type: 'kanban',
      config: {
        statusField: statusField.name
      }
    });
  }

  return views;
}

function createMenus(entity: EntitySchema, commands: CommandManifest[]): MenuManifest[] {
  return [
    {
      id: createId('menu'),
      label: entity.pluralLabel,
      items: commands
        .filter((command) => command.category === entity.label)
        .map((command) => ({
          id: createId('menu_item'),
          label: command.label,
          commandIdentifier: command.identifier
        }))
    },
    {
      id: createId('menu'),
      label: 'Reports',
      items: commands
        .filter((command) => command.category === 'Reporting')
        .map((command) => ({
          id: createId('menu_item'),
          label: command.label,
          commandIdentifier: command.identifier
        }))
    }
  ];
}

function createPerspectives(entity: EntitySchema, views: AppView[]): PerspectiveManifest[] {
  const list = views.find((view) => view.type === 'list');
  const detail = views.find((view) => view.type === 'detail');
  const dashboard = views.find((view) => view.type === 'dashboard');
  const audit = views.find((view) => view.type === 'audit');

  return [
    {
      id: createId('perspective'),
      name: `${entity.name}_control`,
      label: `${entity.label} Control`,
      views: [
        ...(list ? [{ viewId: list.id, region: 'left' as const, ratio: 0.28 }] : []),
        ...(detail ? [{ viewId: detail.id, region: 'center' as const, ratio: 0.52 }] : []),
        ...(dashboard ? [{ viewId: dashboard.id, region: 'right' as const, ratio: 0.2 }] : []),
        ...(audit ? [{ viewId: audit.id, region: 'bottom' as const, ratio: 0.25 }] : [])
      ]
    }
  ];
}
