import { api } from './client';

// Client-side cache to cut round-trips to the free-tier backend/Turso quota. Lives in
// IndexedDB rather than localStorage: localStorage caps at ~5MB of strings, while
// receipt files can add up to gigabytes and IndexedDB stores Blobs natively with a
// disk-sized quota. Entries are namespaced per business (tenant) and expire after 24h.
// Any successful mutation drops the cached JSON responses (see interceptor below);
// receipt files are immutable per invoice id except for the cases in dropReceiptFile.

const DB_NAME = 'smartreceipt-cache';
const RESPONSES = 'responses';
const FILES = 'files';
const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
  savedAt: number;
  value: T;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
// Bumped on every invalidation so a GET that started before a mutation can't write its
// now-stale result back into the cache after the mutation cleared it.
let generation = 0;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(RESPONSES);
          req.result.createObjectStore(FILES);
        };
        req.onsuccess = () => {
          void navigator.storage?.persist?.();
          purgeExpired(req.result);
          resolve(req.result);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function purgeExpired(db: IDBDatabase) {
  const cutoff = Date.now() - TTL_MS;
  const tx = db.transaction([RESPONSES, FILES], 'readwrite');
  for (const name of [RESPONSES, FILES]) {
    tx.objectStore(name).openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      if ((cursor.value as Entry<unknown>).savedAt < cutoff) cursor.delete();
      cursor.continue();
    };
  }
}

function ownerPrefix(): string | null {
  try {
    const business = JSON.parse(localStorage.getItem('smartreceipt_business') ?? 'null');
    return business?.id != null ? `${business.id}:` : null;
  } catch {
    return null;
  }
}

function isFresh(entry: Entry<unknown> | undefined): entry is Entry<unknown> {
  return !!entry && Date.now() - entry.savedAt < TTL_MS;
}

async function idbGet<T>(store: string, key: string): Promise<Entry<T> | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function idbPut(store: string, key: string, entry: Entry<unknown>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    // Quota errors are swallowed: an over-full cache just means fetching from the server.
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(store: string, range: IDBValidKey | IDBKeyRange): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(range);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => resolve();
  });
}

async function cached<T>(
  store: string,
  id: string,
  useMemory: boolean,
  fetcher: () => Promise<T>,
): Promise<T> {
  const prefix = ownerPrefix();
  if (!prefix) return fetcher();
  const key = prefix + id;
  const flightKey = `${store}/${key}`;

  const mem = useMemory ? memory.get(key) : undefined;
  if (isFresh(mem)) return mem.value as T;

  const pending = inFlight.get(flightKey);
  if (pending) return pending as Promise<T>;

  const promise = (async () => {
    const stored = await idbGet<T>(store, key);
    if (isFresh(stored)) {
      if (useMemory) memory.set(key, stored);
      return stored.value;
    }
    const startGeneration = generation;
    const value = await fetcher();
    if (startGeneration === generation) {
      const entry = { savedAt: Date.now(), value };
      if (useMemory) memory.set(key, entry);
      await idbPut(store, key, entry);
    }
    return value;
  })().finally(() => inFlight.delete(flightKey));

  inFlight.set(flightKey, promise);
  return promise;
}

/** Cache-first GET for JSON endpoints (invoice lists, dashboard stats, categories). */
export function cachedGet<T>(path: string): Promise<T> {
  return cached(RESPONSES, path, true, () => api.get<T>(path).then(({ data }) => data));
}

/** Cache-first receipt file bytes. Not kept in the in-memory map — the blobs can be
 * large, and IndexedDB already hands them back disk-backed. */
export function getReceiptFile(invoiceId: number): Promise<Blob> {
  return cached(FILES, String(invoiceId), false, () =>
    api.get<Blob>(`/invoices/${invoiceId}/file`, { responseType: 'blob' }).then(({ data }) => data),
  );
}

/** Must be called when an invoice's file is deleted or replaced (delete, or a conflict
 * resolved with "update_with_new"), since SQLite can reuse a deleted row's id. */
export async function dropReceiptFile(invoiceId: number): Promise<void> {
  const prefix = ownerPrefix();
  if (!prefix) return;
  generation += 1;
  await idbDelete(FILES, prefix + invoiceId);
}

export async function invalidateResponses(): Promise<void> {
  generation += 1;
  memory.clear();
  const prefix = ownerPrefix();
  if (!prefix) return;
  await idbDelete(RESPONSES, IDBKeyRange.bound(prefix, `${prefix}￿`));
}

api.interceptors.response.use(async (response) => {
  const method = response.config.method?.toLowerCase();
  if (method && method !== 'get' && !response.config.url?.startsWith('/auth')) {
    await invalidateResponses();
  }
  return response;
});
