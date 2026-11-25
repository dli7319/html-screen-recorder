/**
 * The take model: everything the app produces and the user might want back.
 *
 * Recordings and screenshots are both takes. Keeping one model for both is why
 * "download any or all" means the same thing for a PNG and a WebM, and why
 * there is exactly one place responsible for the lifetime of a blob URL.
 */

import { dedupeFilename } from './filename';

export type TakeKind = 'recording' | 'screenshot';

export interface Take {
  readonly id: string;
  readonly kind: TakeKind;
  readonly blob: Blob;
  /** Object URL for the blob. Revoked when the take is removed or the store is
   *  destroyed - this is the only place that happens. */
  readonly url: string;
  readonly filename: string;
  readonly size: number;
  /** Present for recordings only. */
  readonly durationMs?: number;
  readonly createdAt: number;
  readonly formatName: string;
  /** Small preview image for the gallery, present once one has been made.
   *  Missing is a normal state, not an error: extraction is best-effort and
   *  rows fall back to their glyph. */
  readonly thumbnail?: Blob;
  /** Object URL for the thumbnail, subject to the same lifetime rules as
   *  `url` - revoked by the store, never by the view. */
  readonly thumbnailUrl?: string;
  /** Set when a thumbnail attempt finished and produced nothing - an
   *  undecodable blob, a timeout, a canvas that refuses to be read back. The
   *  row then shows its glyph for good instead of shimmering on for a still
   *  that is never coming. Persisted alongside the take so a refresh (or a
   *  remove -> undo round-trip) cannot resurrect the wait; a later attempt
   *  that does produce a still clears it. */
  readonly thumbnailUnavailable?: boolean;
}

export interface TakeInput {
  kind: TakeKind;
  blob: Blob;
  filename: string;
  formatName: string;
  durationMs?: number;
  createdAt?: number;
}

/**
 * Everything about a take that survives a refresh: the model minus `url` and
 * `thumbnailUrl`, which name memory in this tab and must be rebuilt on
 * restore. The thumbnail blob itself survives - it is the picture, not a
 * reference to one.
 */
export type TakeRecord = Omit<Take, 'url' | 'thumbnailUrl'>;

/**
 * The slice of persistence the store needs. An interface rather than a direct
 * dependency on the IndexedDB module so the store can be tested against a
 * plain fake and the storage choice can change without touching the model.
 */
export interface TakePersistence {
  put(record: TakeRecord): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Every record still within the cache's retention window, newest first. */
  load(): Promise<TakeRecord[]>;
}

/**
 * A cache that is full, disabled (some private windows), or simply slow must
 * never break a capture: the take is still made, still listed, still
 * downloadable - it just will not survive a refresh. So writes are fire and
 * forget, and only the failure is reported.
 */
function warnCacheFailure(err: unknown): void {
  console.warn('Take cache write failed:', err);
}

/**
 * Owns the collection of takes and the blob URLs hanging off them.
 *
 * The URL lifecycle is the reason this exists as a class rather than an array.
 * A blob URL keeps the whole recording in memory until it is explicitly
 * revoked, and the previous single-download code never revoked anything. One
 * leaked URL was survivable; a gallery of a dozen takes would not be.
 *
 * With a cache attached it is also the only writer of cached takes: the same
 * three operations the gallery can perform - add, remove, clear - are the
 * three that reach storage, so the cache cannot drift from what is listed.
 */
export class TakeStore {
  private takes: Take[] = [];
  private listeners = new Set<() => void>();
  private counter = 0;
  /**
   * Ids must be unique across sessions, not just within one: a restored take
   * keeps the id its cache row is keyed by, and a newly generated id must
   * never collide with one from an earlier session - the cache would silently
   * overwrite the older row. A per-session tag makes that true without a
   * persistence round-trip on every add.
   */
  private readonly sessionTag = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  constructor(private cache?: TakePersistence) {}

  /**
   * Every filename the store has issued this session. A name is never
   * re-issued while a take - live, or removed with its Undo still pending -
   * can come back under it: undoing a removal must find the exact name still
   * waiting, so a remove -> capture -> undo race cannot put two same-named
   * takes back on the shelf. The one release is rename(): once a take has
   * stopped wearing a name for good, nothing can return under it and the name
   * is free to be typed again.
   */
  private claimedNames = new Set<string>();

  add(input: TakeInput): Take {
    // Two captures in the same second share a timestamp name; the second one
    // gets a numbered suffix instead of a twin. Done here, not at the capture
    // sites, so every way a take can enter the gallery is covered and two
    // adds racing in one tick still land distinct names.
    const filename = dedupeFilename(input.filename, this.claimedNames);
    this.claimedNames.add(filename);
    const take: Take = {
      id: this.nextId(),
      kind: input.kind,
      blob: input.blob,
      url: URL.createObjectURL(input.blob),
      filename,
      size: input.blob.size,
      durationMs: input.durationMs,
      createdAt: input.createdAt ?? Date.now(),
      formatName: input.formatName,
    };

    // Newest first: a take you just made is the one you want to reach for.
    this.takes.unshift(take);
    this.cache?.put(TakeStore.toRecord(take)).catch(warnCacheFailure);
    this.emit();
    return take;
  }

  /**
   * The take as stored: blob-backed facts only. Both URL fields name memory
   * in this tab and are rebuilt on restore, so they are stripped here - the
   * one place that happens.
   */
  private static toRecord(take: Take): TakeRecord {
    const { url: _url, thumbnailUrl: _thumbUrl, ...record } = take;
    return record;
  }

  /**
   * Attach the outcome of a thumbnail attempt: the still itself, or `null`
   * when extraction finished without one. Idempotent, and a no-op for an id
   * that has since been removed or cleared - extraction is async and the user
   * is faster than any decoder. Reports whether the take was still there to
   * receive it.
   *
   * A `null` outcome is a result, not a silence: it marks the take so the
   * gallery can stop waiting on a still that is never coming. Without that
   * mark a failed extraction left the row shimmering as "loading" forever.
   */
  setThumbnail(id: string, thumbnail: Blob | null): boolean {
    const take = this.takes.find((candidate) => candidate.id === id);
    if (!take) return false;

    if (!thumbnail) {
      const givenUp: Take = { ...take, thumbnailUnavailable: true };
      this.takes[this.takes.indexOf(take)] = givenUp;
      this.cache?.put(TakeStore.toRecord(givenUp)).catch(warnCacheFailure);
      this.emit();
      return true;
    }

    if (take.thumbnailUrl) URL.revokeObjectURL(take.thumbnailUrl);
    const updated: Take = {
      ...take,
      thumbnail,
      thumbnailUrl: URL.createObjectURL(thumbnail),
      // A still landing is the definitive answer, even after an earlier
      // attempt gave up (the backfill pass retries).
      thumbnailUnavailable: false,
    };
    this.takes[this.takes.indexOf(take)] = updated;

    this.cache?.put(TakeStore.toRecord(updated)).catch(warnCacheFailure);
    this.emit();
    return true;
  }

  /**
   * Rename a take. The blob is untouched - this is the name downloads save as
   * - and the new name is written through to the cache so it survives a
   * refresh alongside the take. Returns the name actually applied, or null
   * when the take was gone.
   *
   * Uniqueness is enforced here for the same reason add() enforces it: one
   * filename may belong to one take, or "Download all" saves two files under
   * one name and the browser's own -2 suffix means the name on the row is not
   * the name on disk. A typed name that is already worn lands on the same
   * numbered suffix captures get, and the caller reports what was applied -
   * the user is told, not silently second-guessed.
   */
  rename(id: string, filename: string): string | null {
    const take = this.takes.find((candidate) => candidate.id === id);
    if (!take) return null;

    // The name it stops wearing goes back on the shelf when no other take
    // wears it, so renaming away and back again does not suffix a take with
    // its own abandoned name. Names held by a removed take are never handed
    // back: remove() keeps them claimed so an Undo can still find its exact
    // name waiting.
    const wornByAnother = this.takes.some(
      (other) => other.id !== id && other.filename === take.filename
    );
    if (!wornByAnother) this.claimedNames.delete(take.filename);

    const applied = dedupeFilename(filename, this.claimedNames);
    this.claimedNames.add(applied);

    const updated: Take = { ...take, filename: applied };
    this.takes[this.takes.indexOf(take)] = updated;

    this.cache?.put(TakeStore.toRecord(updated)).catch(warnCacheFailure);
    this.emit();
    return applied;
  }

  private nextId(): string {
    return `take-${this.sessionTag}-${(++this.counter).toString(36)}`;
  }

  /**
   * Re-populate from the cache. Called once at startup; safe to call on a
   * store that already holds takes (a capture made while the cache was still
   * loading) - existing takes win and the rest merge in by creation time.
   */
  async restore(): Promise<void> {
    if (!this.cache) return;

    let records: TakeRecord[];
    try {
      records = await this.cache.load();
    } catch (err) {
      warnCacheFailure(err);
      return;
    }

    const held = new Set(this.takes.map((take) => take.id));
    const restored = records
      // A record whose id is already listed was written by this session's own
      // add(); listing it twice would double every download.
      .filter((record) => !held.has(record.id))
      .map((record) => {
        // Claimed verbatim - a cached take comes back under the name it was
        // saved with, and no new capture may take that name from it.
        this.claimedNames.add(record.filename);
        return {
          ...record,
          url: URL.createObjectURL(record.blob),
          // Rows cached before thumbnails existed simply have no `thumbnail`;
          // they restore without one and pick it up from the backfill pass.
          thumbnailUrl: record.thumbnail
            ? URL.createObjectURL(record.thumbnail)
            : undefined,
        };
      });
    if (restored.length === 0) return;

    this.takes = [...this.takes, ...restored].sort(
      (a, b) => b.createdAt - a.createdAt
    );
    this.emit();
  }

  /** Remove one take and release its blob URLs. Returns what was removed (blobs
   *  intact, object URLs revoked) so a caller can undo the removal. */
  remove(id: string): TakeRecord | undefined {
    const index = this.takes.findIndex((take) => take.id === id);
    if (index === -1) return undefined;

    const [removed] = this.takes.splice(index, 1);
    const record = TakeStore.toRecord(removed);
    TakeStore.release(removed);
    this.cache?.delete(id).catch(warnCacheFailure);
    this.emit();
    return record;
  }

  /** Remove every take, releasing every blob URLs. Returns what was removed so a
   *  caller can undo the clear. */
  clear(): TakeRecord[] {
    const removed = this.takes.map((take) => TakeStore.toRecord(take));
    for (const take of this.takes) TakeStore.release(take);
    const had = this.takes.length > 0;
    this.takes = [];
    this.cache?.clear().catch(warnCacheFailure);
    if (had) this.emit();
    return removed;
  }

  /**
   * Put a take back exactly as it was - same id, timestamp, filename and
   * thumbnail - to undo a Remove or Clear. `add()` cannot do this: it would
   * mint a fresh id, today's date and a deduped name, silently changing what
   * is being restored. Re-inserts at `index` so the list order comes back too.
   */
  reinsert(record: TakeRecord, index = 0): Take {
    // The name is claimed, not deduped: this is the exact take coming back,
    // and add() already kept any newcomer off its name while it was away.
    this.claimedNames.add(record.filename);
    const take: Take = {
      ...record,
      url: URL.createObjectURL(record.blob),
      thumbnailUrl: record.thumbnail
        ? URL.createObjectURL(record.thumbnail)
        : undefined,
    };
    this.takes.splice(index, 0, take);
    this.cache?.put(TakeStore.toRecord(take)).catch(warnCacheFailure);
    this.emit();
    return take;
  }

  /**
   * Release everything. The store is unusable afterwards.
   *
   * Deliberately does not touch the cache: this is the page going away, not
   * the user saying "forget my takes".
   */
  destroy(): void {
    for (const take of this.takes) TakeStore.release(take);
    this.takes = [];
    this.listeners.clear();
  }

  /** Every blob URL a take holds. Both are owned here and revoked nowhere else. */
  private static release(take: Take): void {
    URL.revokeObjectURL(take.url);
    if (take.thumbnailUrl) URL.revokeObjectURL(take.thumbnailUrl);
  }

  list(): readonly Take[] {
    return this.takes;
  }

  count(): number {
    return this.takes.length;
  }

  totalBytes(): number {
    return this.takes.reduce((total, take) => total + take.size, 0);
  }

  byKind(kind: TakeKind): readonly Take[] {
    return this.takes.filter((take) => take.kind === kind);
  }

  /**
   * Subscribe to changes. Returns the unsubscribe function, so wiring it up is
   * a single call with no bookkeeping on the caller.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    // Snapshot first: a listener may subscribe or unsubscribe while being
    // called, and that must not change who is notified for this change.
    const listeners = Array.from(this.listeners);
    for (const listener of listeners) listener();
  }
}
