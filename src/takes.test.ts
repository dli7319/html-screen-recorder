import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TakeRecord, TakeStore } from './takes';

/**
 * jsdom implements neither createObjectURL nor revokeObjectURL. The whole
 * point of TakeStore is the URL lifecycle, so these are stubbed and asserted
 * on rather than worked around.
 */
let created: string[];
let revoked: string[];
let counter = 0;

beforeEach(() => {
  created = [];
  revoked = [];
  counter = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => {
      const url = `blob:test/${++counter}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const take = (blob = new Blob(['abc'])) => ({
  kind: 'recording' as const,
  blob,
  filename: 'take.webm',
  formatName: 'VP9',
});

describe('TakeStore.add', () => {
  it('records the take with its blob size', () => {
    const store = new TakeStore();
    const added = store.add(take(new Blob(['hello'])));

    expect(added.size).toBe(5);
    expect(added.kind).toBe('recording');
    expect(added.filename).toBe('take.webm');
  });

  it('gives each take a blob URL', () => {
    const store = new TakeStore();
    const added = store.add(take());

    expect(added.url).toBe('blob:test/1');
    expect(created).toEqual(['blob:test/1']);
  });

  it('puts the newest take first', () => {
    // The take you just made is the one you want to reach for.
    const store = new TakeStore();
    const first = store.add({ ...take(), filename: 'first.webm' });
    const second = store.add({ ...take(), filename: 'second.webm' });

    expect(store.list().map((t) => t.id)).toEqual([second.id, first.id]);
  });

  it('gives every take a distinct id', () => {
    const store = new TakeStore();
    const a = store.add(take());
    const b = store.add(take());

    expect(a.id).not.toBe(b.id);
  });

  it('carries the recording duration when there is one', () => {
    const store = new TakeStore();
    expect(store.add({ ...take(), durationMs: 42_000 }).durationMs).toBe(
      42_000
    );
  });

  it('leaves the duration undefined for a screenshot', () => {
    const store = new TakeStore();
    const shot = store.add({ ...take(), kind: 'screenshot' });

    expect(shot.kind).toBe('screenshot');
    expect(shot.durationMs).toBeUndefined();
  });
});

describe('TakeStore.remove', () => {
  it('drops the take and revokes exactly its URL', () => {
    const store = new TakeStore();
    const keep = store.add({ ...take(), filename: 'keep.webm' });
    const gone = store.add({ ...take(), filename: 'gone.webm' });

    store.remove(gone.id);

    expect(store.list().map((t) => t.id)).toEqual([keep.id]);
    expect(revoked).toEqual([gone.url]);
  });

  it('does not revoke a take that stays', () => {
    const store = new TakeStore();
    const keep = store.add(take());
    store.add(take());
    store.clear();
    revoked.length = 0;

    store.remove(keep.id);
    expect(revoked).not.toContain(keep.url);
  });

  it('is a no-op for an unknown id', () => {
    const store = new TakeStore();
    store.add(take());

    expect(() => store.remove('nope')).not.toThrow();
    expect(store.count()).toBe(1);
    expect(revoked).toEqual([]);
  });

  it('leaves the store usable afterwards', () => {
    const store = new TakeStore();
    store.remove(store.add(take()).id);
    const again = store.add(take());

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].id).toBe(again.id);
  });
});

describe('TakeStore.clear', () => {
  it('revokes every URL and empties the list', () => {
    const store = new TakeStore();
    const a = store.add(take());
    const b = store.add(take());

    store.clear();

    expect(store.list()).toEqual([]);
    expect(revoked).toEqual([b.url, a.url]);
  });

  it('is safe on an empty store', () => {
    const store = new TakeStore();
    expect(() => store.clear()).not.toThrow();
    expect(revoked).toEqual([]);
  });
});

describe('TakeStore.destroy', () => {
  it('revokes everything and stops notifying', () => {
    const store = new TakeStore();
    const listener = vi.fn();
    store.onChange(listener);
    store.add(take());

    store.destroy();
    listener.mockClear();
    expect(revoked).toHaveLength(1);

    store.add(take());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('TakeStore accounting', () => {
  it('counts takes of every kind', () => {
    const store = new TakeStore();
    store.add({ ...take(new Blob(['ab'])), kind: 'recording' });
    store.add({ ...take(new Blob(['cde'])), kind: 'screenshot' });
    store.add({ ...take(new Blob(['f'])), kind: 'recording' });

    expect(store.count()).toBe(3);
    expect(store.byKind('recording')).toHaveLength(2);
    expect(store.byKind('screenshot')).toHaveLength(1);
  });

  it('totals the bytes across takes', () => {
    const store = new TakeStore();
    store.add(take(new Blob(['ab'])));
    store.add(take(new Blob(['cde'])));

    expect(store.totalBytes()).toBe(5);
  });

  it('reports zero for nothing captured', () => {
    const store = new TakeStore();
    expect(store.totalBytes()).toBe(0);
    expect(store.count()).toBe(0);
  });

  it('keeps the total honest as takes are removed', () => {
    const store = new TakeStore();
    const gone = store.add(take(new Blob(['abcd'])));
    store.add(take(new Blob(['ef'])));

    expect(store.totalBytes()).toBe(6);
    store.remove(gone.id);
    expect(store.totalBytes()).toBe(2);
  });
});

describe('TakeStore.onChange', () => {
  it('notifies when a take is added', () => {
    const store = new TakeStore();
    const listener = vi.fn();
    store.onChange(listener);

    store.add(take());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies on removal and on clear', () => {
    const store = new TakeStore();
    const listener = vi.fn();
    store.onChange(listener);
    const added = store.add(take());
    listener.mockClear();

    store.remove(added.id);
    store.add(take());
    store.clear();

    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new TakeStore();
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);

    unsubscribe();
    store.add(take());

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify when a no-op removal happens', () => {
    const store = new TakeStore();
    const listener = vi.fn();
    store.add(take());
    listener.mockClear();

    store.remove('nope');
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports several listeners at once', () => {
    const store = new TakeStore();
    const a = vi.fn();
    const b = vi.fn();
    store.onChange(a);
    store.onChange(b);
    store.add(take());

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

/**
 * A minimal cache that records what the store asked of it. The IndexedDB
 * implementation has its own tests; this pins the store's write-through
 * contract against a plain fake.
 */
class FakeCache {
  records = new Map<string, TakeRecord>();
  put = vi.fn(async (record: TakeRecord) => {
    this.records.set(record.id, record);
  });
  delete = vi.fn(async (id: string) => {
    this.records.delete(id);
  });
  clear = vi.fn(async () => {
    this.records.clear();
  });
  load = vi.fn(async () =>
    Array.from(this.records.values()).sort((a, b) => b.createdAt - a.createdAt)
  );
}

describe('TakeStore caching', () => {
  it('writes each take through to the cache without its URL', () => {
    const cache = new FakeCache();
    const store = new TakeStore(cache);
    const added = store.add(take());

    expect(cache.put).toHaveBeenCalledTimes(1);
    const record = cache.put.mock.calls[0][0];
    expect(record.id).toBe(added.id);
    expect(record.blob).toBe(added.blob);
    expect('url' in record).toBe(false);
  });

  it('removes and clears through to the cache too', () => {
    const cache = new FakeCache();
    const store = new TakeStore(cache);
    const added = store.add(take());

    store.remove(added.id);
    expect(cache.delete).toHaveBeenCalledWith(added.id);

    store.add(take());
    store.clear();
    expect(cache.clear).toHaveBeenCalledTimes(1);
  });

  it('still records the take when the cache refuses it', () => {
    // A full or disabled cache must not lose the capture itself - the take is
    // still made and downloadable, it just will not survive a refresh.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new FakeCache();
    cache.put.mockRejectedValue(new Error('quota'));
    const store = new TakeStore(cache);

    const added = store.add(take());

    expect(store.list()).toEqual([added]);
    expect(store.count()).toBe(1);
    warn.mockRestore();
  });

  it('restores cached takes newest first', async () => {
    const cache = new FakeCache();
    const store = new TakeStore(cache);
    store.add({ ...take(), createdAt: 1_000 });
    store.add({ ...take(), createdAt: 3_000 });

    // A fresh session over the same cache.
    const reborn = new TakeStore(cache);
    await reborn.restore();

    expect(reborn.count()).toBe(2);
    expect(reborn.list().map((t) => t.createdAt)).toEqual([3_000, 1_000]);
    expect(reborn.list().every((t) => t.url.startsWith('blob:test/'))).toBe(
      true
    );
  });

  it('merges takes made while the restore was still loading', async () => {
    const cache = new FakeCache();
    const seed = new TakeStore(cache);
    seed.add({ ...take(), createdAt: 1_000 });

    const reborn = new TakeStore(cache);
    const early = reborn.add({ ...take(), createdAt: 2_000 });
    await reborn.restore();

    expect(reborn.list().map((t) => t.createdAt)).toEqual([2_000, 1_000]);
    // No take is listed twice: "Download all" would double-download it.
    expect(reborn.list().filter((t) => t.id === early.id)).toHaveLength(1);
  });

  it('survives a cache that fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new FakeCache();
    cache.load.mockRejectedValue(new Error('no idb in this window'));
    const store = new TakeStore(cache);

    await expect(store.restore()).resolves.toBeUndefined();
    expect(store.count()).toBe(0);
    warn.mockRestore();
  });

  it('removes a restored take from the cache by the id it came back with', async () => {
    const cache = new FakeCache();
    const seed = new TakeStore(cache);
    seed.add(take());

    const reborn = new TakeStore(cache);
    await reborn.restore();
    reborn.remove(reborn.list()[0].id);

    expect(cache.delete).toHaveBeenCalledWith(seed.list()[0].id);
    expect(cache.records.size).toBe(0);
  });

  it('does not empty the cache when the store is destroyed', async () => {
    // destroy() is the page going away, not the user forgetting their takes.
    const cache = new FakeCache();
    const store = new TakeStore(cache);
    store.add(take());

    store.destroy();

    expect(cache.clear).not.toHaveBeenCalled();
    expect(cache.records.size).toBe(1);
  });
});

describe('TakeStore thumbnails', () => {
  const thumb = () => new Blob(['thumb']);

  it('attaches a thumbnail later and writes it through', () => {
    const cache = new FakeCache();
    const store = new TakeStore(cache);
    const added = store.add(take());

    expect(store.setThumbnail(added.id, thumb())).toBe(true);

    const updated = store.list()[0];
    expect(updated.thumbnail).toBeDefined();
    expect(updated.thumbnailUrl).toBeDefined();
    // The blob persists, its URL does not: same contract as `url`.
    const stored = cache.records.get(added.id);
    expect(stored?.thumbnail).toBeDefined();
    expect(stored).not.toHaveProperty('thumbnailUrl');
    expect(stored).not.toHaveProperty('url');
  });

  it('notifies listeners when a thumbnail lands', () => {
    const store = new TakeStore();
    const added = store.add(take());
    const listener = vi.fn();
    store.onChange(listener);

    store.setThumbnail(added.id, thumb());

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for a take that has been removed', () => {
    // Extraction is async and the user is faster than any decoder.
    const cache = new FakeCache();
    const store = new TakeStore(cache);
    const added = store.add(take());
    store.remove(added.id);

    expect(store.setThumbnail(added.id, thumb())).toBe(false);
    expect(cache.records.size).toBe(0);
  });

  it('replaces a thumbnail and releases the old URL', () => {
    const store = new TakeStore();
    const added = store.add(take());
    store.setThumbnail(added.id, thumb());
    const first = store.list()[0].thumbnailUrl;

    store.setThumbnail(added.id, thumb());

    expect(store.list()[0].thumbnailUrl).not.toBe(first);
    expect(revoked).toContain(first);
  });

  it('releases the thumbnail URL alongside the take URL', () => {
    const store = new TakeStore();
    const added = store.add(take());
    store.setThumbnail(added.id, thumb());
    const takeUrl = store.list()[0].url;
    const thumbUrl = store.list()[0].thumbnailUrl;

    store.remove(added.id);

    expect(revoked).toContain(takeUrl);
    expect(revoked).toContain(thumbUrl);
  });

  it('releases every thumbnail URL on clear and on destroy', () => {
    const store = new TakeStore();
    const a = store.add(take());
    const b = store.add(take());
    store.setThumbnail(a.id, thumb());
    const takeA = store.list().find((t) => t.id === a.id);
    const takeB = store.list().find((t) => t.id === b.id);

    store.clear();

    // Two take URLs and the one thumbnail URL.
    expect(revoked).toContain(takeA?.url);
    expect(revoked).toContain(takeA?.thumbnailUrl);
    expect(revoked).toContain(takeB?.url);

    const c = store.add(take());
    store.setThumbnail(c.id, thumb());
    const thumbUrl = store.list().find((t) => t.id === c.id)?.thumbnailUrl;

    store.destroy();
    expect(revoked).toContain(thumbUrl);
  });

  it('rebuilds the thumbnail URL on restore', async () => {
    const cache = new FakeCache();
    const seed = new TakeStore(cache);
    const added = seed.add(take());
    seed.setThumbnail(added.id, thumb());

    const reborn = new TakeStore(cache);
    await reborn.restore();

    const restored = reborn.list()[0];
    expect(restored.thumbnail).toBeDefined();
    expect(restored.thumbnailUrl).toBeDefined();
    // A fresh URL for this session, not the dead one from the last.
    expect(restored.thumbnailUrl).not.toBe(seed.list()[0].thumbnailUrl);
  });

  it('restores old rows that predate thumbnails without one', async () => {
    const cache = new FakeCache();
    const seed = new TakeStore(cache);
    seed.add(take());

    const reborn = new TakeStore(cache);
    await reborn.restore();

    expect(reborn.list()[0].thumbnail).toBeUndefined();
    expect(reborn.list()[0].thumbnailUrl).toBeUndefined();
  });
});
