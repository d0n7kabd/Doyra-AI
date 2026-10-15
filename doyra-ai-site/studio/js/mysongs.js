// "My songs": uploads the visitor chose to keep, stored in this browser only
// (IndexedDB). Nothing is uploaded anywhere.
const DB = 'doyra-studio';
const VERSION = 1;

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx(db, stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

// meta: { id, title, artist, added }   data: { id, bytes, analysis, seed, drums16, engine }
export async function saveSong(meta, data) {
  const db = await open();
  await tx(db, ['meta', 'data'], 'readwrite', (t) => {
    t.objectStore('meta').put({ ...meta, added: Date.now() });
    t.objectStore('data').put({ id: meta.id, ...data });
  });
}

export async function listSongs() {
  try {
    const db = await open();
    const req = await tx(db, ['meta'], 'readonly', (t) => t.objectStore('meta').getAll());
    return (req || []).sort((a, b) => a.added - b.added);
  } catch (e) {
    return []; // private mode or storage blocked: the studio still works
  }
}

export async function getSong(id) {
  const db = await open();
  return tx(db, ['data'], 'readonly', (t) => t.objectStore('data').get(id));
}

export async function hasSong(id) {
  return (await listSongs()).some((s) => s.id === id);
}

export async function removeSong(id) {
  const db = await open();
  await tx(db, ['meta', 'data'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('data').delete(id);
  });
}
