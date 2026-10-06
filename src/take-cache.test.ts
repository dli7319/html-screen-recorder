import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TakeCache, TAKE_TTL_DAYS, TAKE_TTL_MS } from './take-cache';
import { TakeRecord } from './takes';

const DAY_MS = 24 * 60 * 60 * 1000;

// jsdom's Blob does not survive structured clone (it degrades to a plain
// object), while real browsers round-trip Blobs through IndexedDB natively.
// Node's Blob does survive, so the tests store that - the cache code is
// indifferent to which Blob implementation it is handed.
vi.stubGlobal('Blob', NodeBlob);

const record = (over: Partial<TakeRecord> = {}): TakeRecord => ({
  id: 'take-a',
  kind: 'recording',
  blob: new Blob(['video-bytes']),
  filename: 'clip.webm',
  size: 11,
  durationMs: 5_000,
  createdAt: Date.now(),
  formatName: 'VP9',
  ...over,
});

/** Ages that stay inside the retention window. */
const minutesAgo = (n: number) => Date.now() - n * 60 * 1000;

/** Every row in the store, including expired ones the cache hid or swept. */
async function rawRows(): Promise<TakeRecord[]> {
  return new Promise((resolve, reject) => {
    // Opened independently of the cache so this sees what storage actually
    // holds, not what the cache says it holds.
    const opening = indexedDB.open('html-screen-recorder');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const request = opening.result
        .transaction('takes', 'readonly')
        .objectStore('takes')
        .getAll();
      request.onsuccess = () => resolve(request.result as TakeRecord[]);
      request.onerror = () => reject(request.error);
    };
  });
}

afterEach(async () => {
  await new TakeCache().clear();
});

describe('TakeCache round-trip', () => {
  it('gives back the blob and everything about it', async () => {
    const cache = new TakeCache();
    await cache.put(record({ id: 'take-1' }));

    const [loaded] = await cache.load();

    expect(loaded.id).toBe('take-1');
    expect(loaded.filename).toBe('clip.webm');
    expect(loaded.kind).toBe('recording');
    expect(loaded.formatName).toBe('VP9');
    expect(loaded.durationMs).toBe(5_000);
    expect(await loaded.blob.text()).toBe('video-bytes');
  });

  it('returns the newest take first', async () => {
    const cache = new TakeCache();
    await cache.put(record({ id: 'old', createdAt: minutesAgo(2) }));
    await cache.put(record({ id: 'new', createdAt: minutesAgo(1) }));

    expect((await cache.load()).map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('overwrites a take by id rather than duplicating it', async () => {
    const cache = new TakeCache();
    await cache.put(record({ id: 'take-1', filename: 'first.webm' }));
    await cache.put(record({ id: 'take-1', filename: 'second.webm' }));

    const loaded = await cache.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].filename).toBe('second.webm');
  });

  it('deletes one take and keeps the rest', async () => {
    const cache = new TakeCache();
    await cache.put(record({ id: 'keep' }));
    await cache.put(record({ id: 'gone' }));

    await cache.delete('gone');

    expect((await cache.load()).map((r) => r.id)).toEqual(['keep']);
  });

  it('clears everything', async () => {
    const cache = new TakeCache();
    await cache.put(record({ id: 'a' }));
    await cache.put(record({ id: 'b' }));

    await cache.clear();

    expect(await cache.load()).toEqual([]);
    expect(await rawRows()).toEqual([]);
  });
});

describe('TakeCache retention', () => {
  it('keeps takes for 30 days', () => {
    expect(TAKE_TTL_MS).toBe(30 * DAY_MS);
  });

  it('gives back a take that is almost 30 days old', async () => {
    const cache = new TakeCache();
    await cache.put(record({ createdAt: Date.now() - 29 * DAY_MS }));

    expect(await cache.load()).toHaveLength(1);
  });

  it('drops a take that is past 30 days and sweeps it from storage', async () => {
    // Swept, not just hidden: a cache that only hides expired rows keeps
    // paying for them until the user notices.
    const cache = new TakeCache();
    await cache.put(
      record({ id: 'expired', createdAt: Date.now() - 31 * DAY_MS })
    );
    await cache.put(record({ id: 'fresh', createdAt: Date.now() }));

    expect((await cache.load()).map((r) => r.id)).toEqual(['fresh']);
    expect((await rawRows()).map((r) => r.id)).toEqual(['fresh']);
  });

  it('keeps the retention note in the markup in step with the real TTL', () => {
    // The "cached on-device for 30 days" line under the gallery is prose in
    // dist/index.html, and prose does not break the build when the constant
    // moves. This pins the two: change TAKE_TTL_DAYS and this test fails
    // until the note says the same number.
    const html = readFileSync(
      join(process.cwd(), 'dist', 'index.html'),
      'utf8'
    );
    const promised = /cached on-device for (\d+) days/.exec(html);
    expect(promised, 'the gallery must carry a retention note').toBeTruthy();
    expect(Number(promised![1])).toBe(TAKE_TTL_DAYS);
  });
});
