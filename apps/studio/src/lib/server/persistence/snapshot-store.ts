import {
  isPersistenceSnapshot,
  type ClearPersistenceSnapshotResult,
  type LoadPersistenceSnapshotResult,
  type PersistenceAdapter,
  type PersistenceSnapshot,
  type SavePersistenceSnapshotResult
} from '@nublox/persistence-engine';

type GlobalSnapshotStore = typeof globalThis & {
  __nubloxForgeSnapshots?: Map<string, PersistenceSnapshot>;
};

const globalStore = globalThis as GlobalSnapshotStore;
const snapshots = globalStore.__nubloxForgeSnapshots ?? new Map<string, PersistenceSnapshot>();
globalStore.__nubloxForgeSnapshots = snapshots;

export const snapshotStore: PersistenceAdapter = {
  async saveSnapshot(snapshot: PersistenceSnapshot): Promise<SavePersistenceSnapshotResult> {
    if (!isPersistenceSnapshot(snapshot)) {
      return {
        ok: false,
        error: 'Invalid persistence snapshot.'
      };
    }

    snapshots.set(snapshot.app.id, snapshot);

    return {
      ok: true,
      snapshot,
      savedAt: new Date().toISOString()
    };
  },

  async loadLatestSnapshot(appId?: string): Promise<LoadPersistenceSnapshotResult> {
    const snapshot = appId ? snapshots.get(appId) : [...snapshots.values()].at(-1);

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
  },

  async clearSnapshots(appId?: string): Promise<ClearPersistenceSnapshotResult> {
    if (appId) {
      const existed = snapshots.delete(appId);

      return {
        ok: true,
        clearedAt: new Date().toISOString(),
        clearedCount: existed ? 1 : 0
      };
    }

    const clearedCount = snapshots.size;
    snapshots.clear();

    return {
      ok: true,
      clearedAt: new Date().toISOString(),
      clearedCount
    };
  }
};
