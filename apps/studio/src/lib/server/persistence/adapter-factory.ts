import { env } from '$env/dynamic/private';
import { createMysqlPersistenceAdapter } from '@nublox/mysql-adapter';
import { createMysql2Executor } from '@nublox/mysql-adapter/mysql2-executor';
import type { PersistenceAdapter } from '@nublox/persistence-engine';
import { snapshotStore } from './snapshot-store';

export type PersistenceAdapterMode = 'memory' | 'mysql';

let mysqlAdapter: PersistenceAdapter | null = null;

export function getPersistenceAdapter(): PersistenceAdapter {
  const mode = getPersistenceAdapterMode();

  if (mode === 'mysql') {
    mysqlAdapter ??= createMysqlPersistenceAdapter(
      createMysql2Executor({
        host: env.MYSQL_HOST ?? 'localhost',
        port: Number(env.MYSQL_PORT ?? '3306'),
        database: env.MYSQL_DATABASE ?? 'nublox_forge',
        user: env.MYSQL_USER ?? 'root',
        password: env.MYSQL_PASSWORD ?? '',
        connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT ?? '10')
      })
    );

    return mysqlAdapter;
  }

  return snapshotStore;
}

export function getPersistenceAdapterMode(): PersistenceAdapterMode {
  return env.NUBLOX_PERSISTENCE_ADAPTER === 'mysql' ? 'mysql' : 'memory';
}
