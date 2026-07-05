import type { PersistenceAdapter } from '@nublox/persistence-engine';
import { snapshotStore } from './snapshot-store';

export type PersistenceAdapterMode = 'memory' | 'mysql';

export function getPersistenceAdapter(): PersistenceAdapter {
  return snapshotStore;
}

export function getPersistenceAdapterMode(): PersistenceAdapterMode {
  return 'memory';
}
