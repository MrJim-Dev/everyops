"use client";

/**
 * Files a visitor picks on the landing page before they have an account. They wait in this browser (IndexedDB,
 * which can hold files; sessionStorage can't) until sign-up finishes, then the dashboard uploads them and starts
 * setup. Nothing else is kept here: workspaces live in Postgres.
 */
const DB = "everyops";
const STORE = "pending-files";
const KEY = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Keeps the visitor's files for after sign-up, replacing any kept earlier. */
export async function keepPendingFiles(files: File[]): Promise<boolean> {
  try {
    await run<unknown>("readwrite", (store) =>
      files.length
        ? (store.put(files, KEY) as IDBRequest<unknown>)
        : (store.delete(KEY) as IDBRequest<unknown>),
    );
    return true;
  } catch {
    return false;
  }
}

/** The kept files, removed from the browser as they're handed over. Empty if there are none or storage is off. */
export async function takePendingFiles(): Promise<File[]> {
  try {
    const files = await run<File[] | undefined>("readonly", (store) => store.get(KEY));
    if (files?.length) await run("readwrite", (store) => store.delete(KEY));
    return files ?? [];
  } catch {
    return [];
  }
}
