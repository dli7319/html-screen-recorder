/**
 * The take model: everything the app produces and the user might want back.
 *
 * Recordings and screenshots are both takes. Keeping one model for both is why
 * "download any or all" means the same thing for a PNG and a WebM, and why
 * there is exactly one place responsible for the lifetime of a blob URL.
 */

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
 * Owns the collection of takes and the blob URLs hanging off them.
 *
 * The URL lifecycle is the reason this exists as a class rather than an array.
 * A blob URL keeps the whole recording in memory until it is explicitly
 * revoked, and the previous single-download code never revoked anything. One
 * leaked URL was survivable; a gallery of a dozen takes would not be.
 */
export class TakeStore {
  private takes: Take[] = [];
  private listeners = new Set<() => void>();
  private counter = 0;

  add(input: TakeInput): Take {
    const take: Take = {
      id: `take-${++this.counter}`,
      kind: input.kind,
      blob: input.blob,
      url: URL.createObjectURL(input.blob),
      filename: input.filename,
      size: input.blob.size,
      durationMs: input.durationMs,
      createdAt: input.createdAt ?? Date.now(),
      formatName: input.formatName,
    };

    // Newest first: a take you just made is the one you want to reach for.
    this.takes.unshift(take);
    this.emit();
    return take;
  }

  /** Remove one take and release its blob URL. */
  remove(id: string): void {
    const index = this.takes.findIndex((take) => take.id === id);
    if (index === -1) return;

    const [removed] = this.takes.splice(index, 1);
    URL.revokeObjectURL(removed.url);
    this.emit();
  }

  /** Remove every take, releasing every blob URL. */
  clear(): void {
    for (const take of this.takes) URL.revokeObjectURL(take.url);
    const had = this.takes.length > 0;
    this.takes = [];
    if (had) this.emit();
  }

  /** Release everything. The store is unusable afterwards. */
  destroy(): void {
    this.clear();
    this.listeners.clear();
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
