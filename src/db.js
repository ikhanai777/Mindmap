// Local-first storage: IndexedDB via idb. Maps autosave on every change;
// one version snapshot per map per day.
import { openDB } from 'idb';
import { serialize, migrate } from './model.js';

let dbp = null;
function db() {
  if (!dbp) {
    dbp = openDB('constellate', 1, {
      upgrade(d) {
        d.createObjectStore('maps', { keyPath: 'id' });
        const snaps = d.createObjectStore('snapshots', { keyPath: 'key' });
        snaps.createIndex('mapId', 'mapId');
        d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

export async function listMaps() {
  const all = await (await db()).getAll('maps');
  return all
    .map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt, count: m.nodes?.length || 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadMap(id) {
  const json = await (await db()).get('maps', id);
  return json ? migrate(json) : null;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function saveMap(doc) {
  const d = await db();
  const json = serialize(doc);
  await d.put('maps', json);
  const key = `${doc.id}:${today()}`;
  if (!(await d.getKey('snapshots', key))) {
    await d.put('snapshots', { key, mapId: doc.id, date: today(), savedAt: Date.now(), json });
    // keep the 30 most recent daily snapshots per map
    const keys = await d.getAllKeysFromIndex('snapshots', 'mapId', doc.id);
    keys.sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 30))) await d.delete('snapshots', k);
  }
}

export async function deleteMap(id) {
  const d = await db();
  await d.delete('maps', id);
  for (const k of await d.getAllKeysFromIndex('snapshots', 'mapId', id)) await d.delete('snapshots', k);
}

export async function listSnapshots(mapId) {
  const all = await (await db()).getAllFromIndex('snapshots', 'mapId', mapId);
  return all.map((s) => ({ key: s.key, date: s.date, count: s.json.nodes.length })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function loadSnapshot(key) {
  const s = await (await db()).get('snapshots', key);
  return s ? migrate(s.json) : null;
}

export async function getMeta(key, fallback = null) {
  try {
    const v = await (await db()).get('meta', key);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export async function setMeta(key, value) {
  try {
    await (await db()).put('meta', value, key);
  } catch { /* storage unavailable: settings stay in memory */ }
}
