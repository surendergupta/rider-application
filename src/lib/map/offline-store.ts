// Stores the downloaded map file (a Blob) in IndexedDB so the map works with no internet.
const DB_NAME = "lrp-maps";
const STORE = "files";

export interface StoredMap {
  blob: Blob;
  savedAt: number;
  bytes: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      }),
  );
}

export const getStoredMap = (key: string) => run<StoredMap | undefined>("readonly", (s) => s.get(key));
export const putStoredMap = (key: string, value: StoredMap) => run("readwrite", (s) => s.put(value, key));
export const deleteStoredMap = (key: string) => run("readwrite", (s) => s.delete(key));

/** Streams a file with progress. Throws if the response is not OK or the size is clearly wrong. */
export async function downloadWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array<ArrayBuffer>);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  if (total && loaded !== total) throw new Error("Download was incomplete. Try again.");
  return new Blob(chunks, { type: "application/octet-stream" });
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
