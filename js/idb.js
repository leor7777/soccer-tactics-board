// Minimal IndexedDB key-value store with a localStorage fallback.
const DB = 'soccer-tactics-board', STORE = 'kv';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  }));
}

export async function get(key) {
  try { return await run('readonly', (s) => s.get(key)); }
  catch {
    try { const v = localStorage.getItem(DB + ':' + key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
  }
}

export async function set(key, value) {
  try { await run('readwrite', (s) => s.put(value, key)); return true; }
  catch {
    try { localStorage.setItem(DB + ':' + key, JSON.stringify(value)); return true; } catch { return false; }
  }
}
