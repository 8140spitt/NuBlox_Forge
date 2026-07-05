import { json } from '@sveltejs/kit';
import { isPersistenceSnapshot } from '@nublox/persistence-engine';
import { snapshotStore } from '$lib/server/persistence/snapshot-store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const appId = url.searchParams.get('appId') ?? undefined;
  const result = await snapshotStore.loadLatestSnapshot(appId);

  return json(result, {
    status: result.ok ? 200 : 404
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const snapshot = isPersistenceSnapshot(body)
    ? body
    : isObject(body) && isPersistenceSnapshot(body.snapshot)
      ? body.snapshot
      : null;

  if (!snapshot) {
    return json(
      {
        ok: false,
        error: 'Invalid snapshot payload.'
      },
      { status: 400 }
    );
  }

  const result = await snapshotStore.saveSnapshot(snapshot);

  return json(result, {
    status: result.ok ? 200 : 400
  });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const appId = url.searchParams.get('appId') ?? undefined;
  const result = await snapshotStore.clearSnapshots(appId);

  return json(result, {
    status: result.ok ? 200 : 400
  });
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
