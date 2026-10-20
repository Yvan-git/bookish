/**
 * Persistence layer.
 * IndexedDB is the source of truth; an in-memory mirror is kept for instant
 * filtering/searching (a personal library is small enough to hold in RAM).
 */
import { uid } from './util.js';

const DB_NAME = 'bookish';
const DB_VERSION = 1;
const STORES = ['books', 'locations', 'tags', 'settings'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        const s = db.createObjectStore('books', { keyPath: 'id' });
        s.createIndex('isbn13', 'isbn13', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('locations')) db.createObjectStore('locations', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  try {
    const store = await tx(storeName);
    return (await wrap(store.getAll())) || [];
  } catch (_) {
    return [];
  }
}

export async function put(storeName, value) {
  const store = await tx(storeName, 'readwrite');
  await wrap(store.put(value));
  return value;
}

export async function putMany(storeName, values) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(storeName, 'readwrite');
    const s = t.objectStore(storeName);
    values.forEach((v) => s.put(v));
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return values;
}

export async function remove(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return wrap(store.delete(key));
}

export async function clearStore(storeName) {
  const store = await tx(storeName, 'readwrite');
  return wrap(store.clear());
}

export async function getSetting(key, fallback = null) {
  const all = await getAll('settings');
  const row = all.find((r) => r.key === key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await put('settings', { key, value });
  return value;
}

/* ------------------------------------------------------------------ */
/* In-memory state + domain operations                                */
/* ------------------------------------------------------------------ */

export const state = {
  books: [],
  locations: [],
  tags: [],
  settings: {
    googleBooksApiKey: '',
    googleClientId: '',
    driveEnabled: false,
    driveFileName: 'books-inventory.xlsx',
    driveFolderId: '',
    driveAutoSync: true,
    theme: 'auto',
    defaultLocationId: '',
    lastLocationId: '',
    lastSyncAt: '',
    driveFileId: '',
    driveJsonFileId: '',
  },
  ready: false,
};

const listeners = new Set();

/** Subscribe to state changes (UI refresh). */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitChange(reason = 'update') {
  listeners.forEach((fn) => {
    try { fn(reason); } catch (e) { console.error(e); }
  });
}

/** Load everything from IndexedDB into memory. */
export async function loadAll() {
  const [books, locations, tags, saved] = await Promise.all([
    getAll('books'),
    getAll('locations'),
    getAll('tags'),
    getAll('settings'),
  ]);
  state.books = books.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  state.locations = locations;
  state.tags = tags;
  saved.forEach((row) => { state.settings[row.key] = row.value; });
  state.ready = true;
  emitChange('load');
  return state;
}

export function getSettings() {
  return state.settings;
}

export async function updateSetting(key, value) {
  state.settings[key] = value;
  await setSetting(key, value);
  emitChange('settings');
  return value;
}

/* --------------------------- locations --------------------------- */

export function locationLabel(loc) {
  if (!loc) return '';
  const room = [loc.room, loc.zone].filter(Boolean).join(' ');
  const shelf = [loc.shelf, loc.position].filter(Boolean).join(' ');
  if (room && shelf) return `${room}, ${shelf}`;
  return room || shelf || loc.label || '';
}

/** Build a location object from its four components. */
export function makeLocation({ room, zone, shelf, position, note = '' }) {
  const parts = [room, zone, shelf, position].map((x) => String(x || '').trim());
  return {
    id: uid(),
    room: parts[0],
    zone: parts[1],
    shelf: parts[2],
    position: parts[3],
    note,
    label: locationLabel({ room: parts[0], zone: parts[1], shelf: parts[2], position: parts[3] }),
    createdAt: new Date().toISOString(),
  };
}

export async function addLocation(loc) {
  const record = { ...loc, id: loc.id || uid(), createdAt: loc.createdAt || new Date().toISOString() };
  record.label = record.label || locationLabel(record);
  state.locations.push(record);
  await put('locations', record);
  emitChange('locations');
  return record;
}

export async function updateLocation(id, patch) {
  const idx = state.locations.findIndex((l) => l.id === id);
  if (idx < 0) return null;
  const next = { ...state.locations[idx], ...patch };
  next.label = locationLabel(next) || next.label;
  state.locations[idx] = next;
  await put('locations', next);
  emitChange('locations');
  return next;
}

export async function deleteLocation(id) {
  state.locations = state.locations.filter((l) => l.id !== id);
  await remove('locations', id);
  // Books referencing it become unassigned.
  const affected = state.books.filter((b) => b.locationId === id);
  for (const b of affected) {
    b.locationId = '';
    b.updatedAt = new Date().toISOString();
    await put('books', b);
  }
  emitChange('locations');
  return affected.length;
}

export function findLocation(id) {
  return state.locations.find((l) => l.id === id) || null;
}

/** Locations grouped by room for the pickers. */
export function locationsByRoom() {
  const map = new Map();
  state.locations.forEach((l) => {
    const key = l.room || '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
  });
  map.forEach((list) => list.sort((a, b) => locationLabel(a).localeCompare(locationLabel(b))));
  return map;
}

/* ------------------------------ tags ------------------------------ */

export function findTag(id) {
  return state.tags.find((x) => x.id === id) || null;
}

export function tagName(id) {
  const tag = findTag(id);
  return tag ? tag.name : '';
}

export async function addTag({ name, category = '' }) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = state.tags.find((x) => x.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const tag = { id: uid(), name: clean, category: String(category || '').trim(), createdAt: new Date().toISOString() };
  state.tags.push(tag);
  await put('tags', tag);
  emitChange('tags');
  return tag;
}

export async function updateTag(id, patch) {
  const idx = state.tags.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const next = { ...state.tags[idx], ...patch };
  state.tags[idx] = next;
  await put('tags', next);
  emitChange('tags');
  return next;
}

export async function deleteTag(id) {
  state.tags = state.tags.filter((x) => x.id !== id);
  await remove('tags', id);
  for (const b of state.books) {
    if ((b.tagIds || []).includes(id)) {
      b.tagIds = b.tagIds.filter((t) => t !== id);
      b.updatedAt = new Date().toISOString();
      await put('books', b);
    }
  }
  emitChange('tags');
}

/* ------------------------------ books ----------------------------- */

export function blankBook() {
  return {
    id: uid(),
    isbn13: '',
    isbn10: '',
    title: '',
    subtitle: '',
    authors: [],
    publisher: '',
    year: '',
    language: '',
    pages: '',
    collection: '',
    dewey: '',
    subjects: [],
    description: '',
    coverUrl: '',
    catalogueUrl: '',
    source: 'manual',
    sourceId: '',
    rating: 0,
    tagIds: [],
    locationId: '',
    notes: '',
    borrowed: false,
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function findBook(id) {
  return state.books.find((b) => b.id === id) || null;
}

export function findByIsbn(isbn) {
  const clean = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (!clean) return null;
  return state.books.find((b) => b.isbn13 === clean || b.isbn10 === clean) || null;
}

export async function addBook(book) {
  const record = { ...blankBook(), ...book, id: book.id || uid() };
  record.updatedAt = record.addedAt || new Date().toISOString();
  state.books.unshift(record);
  await put('books', record);
  if (record.locationId) await updateSetting('lastLocationId', record.locationId);
  emitChange('books');
  return record;
}

export async function updateBook(id, patch) {
  const idx = state.books.findIndex((b) => b.id === id);
  if (idx < 0) return null;
  const next = { ...state.books[idx], ...patch, id, updatedAt: new Date().toISOString() };
  state.books[idx] = next;
  await put('books', next);
  if (next.locationId) await updateSetting('lastLocationId', next.locationId);
  emitChange('books');
  return next;
}

export async function deleteBook(id) {
  state.books = state.books.filter((b) => b.id !== id);
  await remove('books', id);
  emitChange('books');
}

export async function clearAllData() {
  await Promise.all(STORES.map((s) => clearStore(s)));
  state.books = [];
  state.locations = [];
  state.tags = [];
  state.settings = {
    googleBooksApiKey: '',
    googleClientId: '',
    driveEnabled: false,
    driveFileName: 'books-inventory.xlsx',
    driveFolderId: '',
    driveAutoSync: true,
    theme: 'auto',
    defaultLocationId: '',
    lastLocationId: '',
    lastSyncAt: '',
    driveFileId: '',
    driveJsonFileId: '',
  };
  emitChange('clear');
}

/** Full snapshot used for JSON export and Drive upload. */
export function snapshot() {
  return {
    format: 'bookish-inventory',
    version: 1,
    exportedAt: new Date().toISOString(),
    books: state.books,
    locations: state.locations,
    tags: state.tags,
  };
}

/** Merge an imported snapshot into the current library (id-safe). */
export async function importSnapshot(data, { replace = false } = {}) {
  if (!data || data.format !== 'bookish-inventory') throw new Error('format');
  const books = Array.isArray(data.books) ? data.books : [];
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const tags = Array.isArray(data.tags) ? data.tags : [];
  if (replace) {
    await Promise.all(STORES.map((s) => clearStore(s)));
    state.books = [];
    state.locations = [];
    state.tags = [];
  }
  const knownBooks = new Set(state.books.map((b) => b.id));
  const newBooks = books.filter((b) => b && b.id && !knownBooks.has(b.id));
  const knownLoc = new Set(state.locations.map((l) => l.id));
  const newLocs = locations.filter((l) => l && l.id && !knownLoc.has(l.id));
  const knownTags = new Set(state.tags.map((x) => x.id));
  const newTags = tags.filter((x) => x && x.id && !knownTags.has(x.id));

  state.books.push(...newBooks);
  state.locations.push(...newLocs);
  state.tags.push(...newTags);
  await Promise.all([
    putMany('books', newBooks),
    putMany('locations', newLocs),
    putMany('tags', newTags),
  ]);
  emitChange('import');
  return newBooks.length;
}
