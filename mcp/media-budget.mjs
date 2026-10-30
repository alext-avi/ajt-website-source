import { mediaFilename } from '../src/lib/media.ts';
import { sqlText } from '../src/lib/content-records.mjs';
import { randomUUID } from 'node:crypto';

export const mediaStorageCeiling = 8_000_000_000;
export const mediaOperationCeilings = { put: 5_000, get: 10_000 };
// Only locally generated, non-sensitive budget diagnostics may cross adapters.
export class MediaBudgetError extends Error {}

export async function reserveMediaStorage(
  store,
  filename,
  bytes,
  { version = false } = {},
) {
  if (
    !mediaFilename.test(filename) ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > 100 * 1024 * 1024
  )
    throw new Error('Invalid media storage reservation');
  // B2 retains object versions. Count every attempted PUT, even concurrent or
  // uncertain retries, rather than assuming replacement frees the old bytes.
  const reservation = version ? `${filename}:b2:${randomUUID()}` : filename;
  try {
    await store.query(
      `INSERT INTO media_storage_reservations(filename,bytes) VALUES(${sqlText(reservation)},${bytes}) ON CONFLICT(filename) DO NOTHING RETURNING filename;`,
    );
    const existing = (
      await store.query(
        `SELECT bytes FROM media_storage_reservations WHERE filename=${sqlText(reservation)};`,
      )
    )[0];
    if (existing?.bytes !== bytes) throw new Error();
  } catch {
    throw new MediaBudgetError(
      'Media storage safety check failed or the 8 GB ceiling was reached. No upload was attempted. Check the media-budget migration and reservations before retrying.',
    );
  }
}

export async function reserveMediaOperation(store, operation) {
  const ceiling = mediaOperationCeilings[operation];
  if (!Number.isSafeInteger(ceiling))
    throw new Error('Unsupported media operation');
  const rows = await store.query(
    `INSERT INTO media_operation_budget(month,operation,attempts) VALUES(strftime('%Y-%m','now'),${sqlText(operation)},1) ON CONFLICT(month,operation) DO UPDATE SET attempts=attempts+1 WHERE attempts<${ceiling} RETURNING attempts;`,
  );
  if (!rows.length)
    throw new Error(
      `Media ${operation === 'put' ? 'upload' : 'download'} safety limit reached for this UTC calendar month. No storage operation was attempted.`,
    );
}
