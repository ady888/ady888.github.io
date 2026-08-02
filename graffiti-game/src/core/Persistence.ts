/**
 * Storage plumbing.
 *
 * Small structured state (profile, inventory, stroke history) lives in
 * localStorage because it is synchronous and trivially inspectable. Photos are
 * fat base64 blobs, so they go in IndexedDB where the quota is measured in
 * megabytes rather than the ~5 MB localStorage ceiling.
 *
 * Both layers degrade to a no-op in-memory store if the browser blocks storage
 * (private mode, disabled cookies) so the game still runs, just without saves.
 */

const DB_NAME = "alleykings";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";

export function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    console.warn(`[Persistence] failed to read "${key}"`, error);
    return null;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[Persistence] failed to write "${key}"`, error);
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to clean up */
  }
}

/** Minimal promise wrapper over a single IndexedDB object store. */
export class PhotoStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private readonly memory = new Map<string, unknown>();

  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn("[PhotoStore] IndexedDB unavailable, using memory fallback.");
        resolve(null);
      };
    });
    return this.dbPromise;
  }

  async put<T extends { id: string }>(record: T): Promise<void> {
    const db = await this.open();
    if (!db) {
      this.memory.set(record.id, record);
      return;
    }
    await this.tx(db, "readwrite", (store) => store.put(record));
  }

  async all<T>(): Promise<T[]> {
    const db = await this.open();
    if (!db) return [...this.memory.values()] as T[];
    return new Promise((resolve) => {
      const tx = db.transaction(PHOTO_STORE, "readonly");
      const request = tx.objectStore(PHOTO_STORE).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as T[]);
      request.onerror = () => resolve([]);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    if (!db) {
      this.memory.delete(id);
      return;
    }
    await this.tx(db, "readwrite", (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    const db = await this.open();
    if (!db) {
      this.memory.clear();
      return;
    }
    await this.tx(db, "readwrite", (store) => store.clear());
  }

  private tx(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(PHOTO_STORE, mode);
        run(transaction.objectStore(PHOTO_STORE));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
