import { json } from '@sveltejs/kit';
import { isPersistenceSnapshot } from '@nublox/persistence-engine';
import { getPersistenceAdapter, getPersistenceAdapterMode } from '$lib/server/persistence/adapter-factory';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const appId = url.searchParams.get('appId') ?? undefined;
  const adapter = getPersistenceAdapter();
  const result = await adapter.loadLatestSnapshot(appId);

  return json(
    {
      ...result,
      adapterMode: getPersistenceAdapterMode()
    },
    {
      status: result.ok ? 200 : 404
    }
  );
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
        error: 'Invalid snapshot payload.',
        adapterMode: getPersistenceAdapterMode()
      },
      { status: 400 }
    );
  }

  const adapter = getPersistenceAdapter();
  const result = await adapter.saveSnapshot(snapshot);

  return json(
    {
      ...result,
      adapterMode: getPersistenceAdapterMode()
    },
    {
      status: result.ok ? 200 : 400
    }
  );
};

export const DELETE: RequestHandler = async ({ url }) => {
  const appId = url.searchParams.get('appId') ?? undefined;
  const adapter = getPersistenceAdapter();
  const result = await adapter.clearSnapshots(appId);

  return json(
    {
      ...result,
      adapterMode: getPersistenceAdapterMode()
    },
    {
      status: result.ok ? 200 : 400
    }
  );
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
