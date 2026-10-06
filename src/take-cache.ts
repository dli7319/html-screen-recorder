/**
 * Persistent cache for takes: what the user makes survives a refresh.
 *
 * Takes used to live in memory only, so reloading the page threw away every
 * recording and screenshot still sitting in "Takes" - exactly the moment a
 * user most wants the thing they just made. This caches them in IndexedDB and
 * hands them back on the next load, for 30 days.
 *
 * IndexedDB rather than localStorage because a take is a blob: a 30-second
 * recording is megabytes, and localStorage is a synchronous string store with
 * a single-digit megabyte budget. Blobs are structured-cloneable, so they go
 * in as-is - no base64, no re-encoding.
 */
import { TakePersistence, TakeRecord } from './takes';

/**
 * How long a cached take is kept, and the same number in days for anything
 * that has to say it in words - the note under the gallery is prose in the
 * markup, and prose and code drift apart silently unless a test pins them.
 *
 * Thirty days: long enough that "I made that a while ago" still finds it,
 * short enough that the cache cannot quietly become a video archive the user
 * never asked for. Expiry is enforced when the cache is read, which is the
 * only time stale rows matter.
 */
export const TAKE_TTL_DAYS = 30;
export const TAKE_TTL_MS = TAKE_TTL_DAYS * 24 * 60 * 60 * 1000;

const DB_NAME = 'html-screen-recorder';
const DB_VERSION = 1;
const STORE_NAME = 'takes';

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      // Keyed by the take's own id so a restore round-trips: the store deletes
      // a cached row by exactly the id it was given back.
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB-backed TakePersistence.
 *
 * Every method resolves after its transaction commits, so callers that care
 * about ordering - a delete racing a put on the same id - can await. The
 * store itself fires these off without waiting; a cache that is slow or full
 * must never block a capture.
 */
export class TakeCache implements TakePersistence {
  private db: Promise<IDBDatabase> | null = null;

  /** One open connection per page. Reused after the first call resolves. */
  private database(): Promise<IDBDatabase> {
    this.db ??= openDatabase();
    return this.db;
  }

  async put(record: TakeRecord): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await transactionDone(tx);
  }

  async delete(id: string): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await transactionDone(tx);
  }

  /**
   * Every take still within the TTL, newest first.
   *
   * Expired rows are deleted here rather than by a timer: the cache is only
   * read on load, so this is the one moment stale rows would be seen, and a
   * sweep costs nothing extra alongside the read that already happened.
   */
  async load(): Promise<TakeRecord[]> {
    const db = await this.database();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const all = await requestAsPromise(store.getAll());

    const cutoff = Date.now() - TAKE_TTL_MS;
    const fresh = all.filter((record) => !recordExpired(record, cutoff));
    for (const stale of all) {
      if (recordExpired(stale, cutoff)) store.delete(stale.id);
    }

    await transactionDone(tx);
    return fresh.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function recordExpired(record: TakeRecord, cutoff: number): boolean {
  return record.createdAt < cutoff;
}
