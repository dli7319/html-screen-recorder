import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TakeStore } from './takes';

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
