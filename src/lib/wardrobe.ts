import type { Garment, Presentation, Selection } from "./outfit";

type Preferences = { selection: Selection; presentation: Presentation };
let database: Promise<IDBDatabase> | undefined;
function openDB() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("outfit-builder", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("garments", { keyPath: "id" });
      request.result.createObjectStore("preferences");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Close other Outfit Builder tabs and try again.")); };
  });
  return database;
}

async function transact<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error || request.error);
    transaction.onabort = () => reject(transaction.error || new Error("Storage is full or unavailable. Remove an item and try again."));
  });
}

export async function readWardrobe() {
  return (await transact<Garment[]>("garments", "readonly", s => s.getAll())).sort((a, b) => b.createdAt - a.createdAt);
}
export async function saveGarment(garment: Garment) { await transact("garments", "readwrite", s => s.put(garment)); }
export async function deleteGarment(id: string) { await transact("garments", "readwrite", s => s.delete(id)); }
export function readPreferences() { return transact<Preferences | undefined>("preferences", "readonly", s => s.get("outfit")); }
export async function savePreferences(value: Preferences) { await transact("preferences", "readwrite", s => s.put(value, "outfit")); }
