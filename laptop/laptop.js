/**
 * Laptop workspace.
 *
 * Pulls the inventory produced by the Android app from Google Drive, then
 * lets you browse, classify, audit and export it.
 */
import { buildWorkbook, buildInventoryWorkbook } from '../shared/xlsx.js';
import { barChart, hBarChart, paretoChart, donutChart, legendList, palette } from '../shared/charts.js';

const $ = (s) => document.querySelector(s);
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const state = {
  books: [],
  locations: [],
  tags: [],
  token: '',
  files: [],
  loadedAt: '',
};

/* ------------------------------ helpers ------------------------------ */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const num = (n) => new Intl.NumberFormat('fr-FR').format(n);

function setStatus(text, kind = '') {
  const node = $('#status');
  node.textContent = text;
  node.className = `status-pill ${kind}`;
}

function toast(msg, kind = 'info') {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.append(host);
  }
  const node = document.createElement('div');
  node.className = `toast toast--${kind}`;
  node.textContent = msg;
  host.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(() => { node.classList.remove('is-in'); setTimeout(() => node.remove(), 300); }, 3200);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const tagById = new Map();
const locById = new Map();
const refreshMaps = () => {
  tagById.clear();
  state.tags.forEach((t) => tagById.set(t.id, t));
  locById.clear();
  state.locations.forEach((l) => locById.set(l.id, l));
};

function roomOf(book) {
  const loc = locById.get(book.locationId);
  return loc?.room || '—';
}
function shelfOf(book) {
  const loc = locById.get(book.locationId);
  return loc?.shelf ? `${loc.room ? loc.room + ' › ' : ''}${loc.shelf}` : '—';
}
function authorOf(book) {
  return (book.authors || [])[0] || '—';
}

/* ------------------------------- Google ------------------------------- */

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(window.google); return; }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google) : reject(new Error('GIS indisponible')));
    s.onerror = () => reject(new Error('GIS indisponible (hors ligne ?)'));
    document.head.append(s);
  });
}

let tokenClient = null;
async function connect(clientId) {
  const google = await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (r) => {
      if (r.error) { toast(`Connexion refusée : ${r.error}`, 'error'); return; }
      state.token = r.access_token;
      setStatus('Connecté', 'is-ok');
      toast('Connecté à Google Drive', 'success');
      listFiles();
      pull();
    },
  });
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function driveGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function listFiles() {
  if (!state.token) return;
  // `drive.file` only exposes the files created by this application.
  const q = encodeURIComponent('trashed = false');
  try {
    const res = await driveGet(`${DRIVE_API}/files?q=${q}&spaces=drive&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')}&pageSize=20`);
    const json = await res.json();
    state.files = json.files || [];
    const host = $('#drive-files');
    host.innerHTML = '';
    if (!state.files.length) {
      host.textContent = 'Aucun fichier trouvé.';
      return;
    }
    state.files.forEach((f) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)';
      row.innerHTML = `<span class="grow" style="overflow:hidden;text-overflow:ellipsis">${f.name}</span>
        <span class="tiny muted nowrap">${fmtDate(f.modifiedTime)}</span>
        <button class="btn btn--secondary btn--sm" data-id="${f.id}" data-name="${f.name}">Charger</button>`;
      row.querySelector('button').addEventListener('click', () => downloadFile(f.id, f.name));
      host.append(row);
    });
  } catch (err) {
    toast(`Liste impossible : ${err.message}`, 'error');
  }
}

async function downloadFile(fileId, name) {
  try {
    const res = await driveGet(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
    const text = await res.text();
    const data = JSON.parse(text);
    if (data.format === 'bookish-inventory') {
      loadData(data);
      toast(`${name} chargé`, 'success');
    } else {
      toast('Ce fichier n’est pas un instantané Bookish (.json)', 'error');
    }
  } catch (err) {
    toast(`Téléchargement impossible : ${err.message}`, 'error');
  }
}

/** Pull the newest inventory snapshot available on Drive. */
async function pull() {
  if (!state.token) { toast('Connectez-vous d’abord', 'error'); return; }
  setStatus('Téléchargement…');
  try {
    // The `drive.file` scope only exposes the files this app created, so we
    // can list them all and pick the snapshot ourselves — this keeps working
    // even if the file name was changed in the phone settings.
    const q = encodeURIComponent('trashed = false');
    const res = await driveGet(`${DRIVE_API}/files?q=${q}&spaces=drive&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}&pageSize=50`);
    const json = await res.json();
    const files = (json.files || []).sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
    const target = files.find((f) => f.name.endsWith('.json'))
      || files.find((f) => /spreadsheet/i.test(f.mimeType || ''))
      || files[0];
    if (!target) {
      setStatus('Aucun inventaire sur Drive', '');
      toast('Aucun fichier d’inventaire trouvé sur Drive.', 'error');
      return;
    }
    const fileRes = await driveGet(`${DRIVE_API}/files/${encodeURIComponent(target.id)}?alt=media`);
    const data = JSON.parse(await fileRes.text());
    loadData(data);
    setStatus(`À jour · ${fmtDate(new Date())}`, 'is-ok');
    toast(`${num(state.books.length)} livre(s) récupéré(s)`, 'success');
    listFiles();
  } catch (err) {
    setStatus('Erreur', 'is-err');
    toast(`Synchronisation impossible : ${err.message}`, 'error');
  }
}

function loadData(data) {
  state.books = data.books || [];
  state.locations = data.locations || [];
  state.tags = data.tags || [];
  state.loadedAt = new Date().toISOString();
  refreshMaps();
  buildFilterOptions();
  renderTable();
  renderGroups();
  renderQuality();
  renderStats();
}

/* ------------------------------- table ------------------------------- */

const COLUMNS = [
  { key: 'title', label: 'Titre', get: (b) => b.title || '' },
  { key: 'author', label: 'Auteur', get: (b) => authorOf(b) },
  { key: 'isbn', label: 'ISBN', get: (b) => b.isbn13 || b.isbn10 || '' },
  { key: 'publisher', label: 'Éditeur', get: (b) => b.publisher || '' },
  { key: 'year', label: 'Année', get: (b) => b.year || '' },
  { key: 'room', label: 'Pièce', get: (b) => roomOf(b) },
  { key: 'shelf', label: 'Étagère', get: (b) => shelfOf(b) },
  { key: 'tags', label: 'Étiquettes', get: (b) => (b.tagIds || []).map((id) => tagById.get(id)?.name).filter(Boolean).join(', ') },
  { key: 'rating', label: 'Note', get: (b) => b.rating || 0, num: true },
  { key: 'source', label: 'Source', get: (b) => b.source || 'manual' },
];

let sortKey = 'title';
let sortDir = 1;

function filteredBooks() {
  const q = norm($('#q').value.trim());
  const room = $('#filter-room').value;
  const tag = $('#filter-tag').value;
  let list = state.books.filter((b) => {
    if (room && roomOf(b) !== room) return false;
    if (tag && !(b.tagIds || []).includes(tag)) return false;
    if (!q) return true;
    const hay = norm([
      b.title, b.subtitle, (b.authors || []).join(' '), b.publisher, b.isbn13, b.isbn10,
      b.notes, b.collection, (b.subjects || []).join(' '),
      (b.tagIds || []).map((id) => tagById.get(id)?.name).join(' '),
      roomOf(b), shelfOf(b),
    ].filter(Boolean).join(' '));
    return hay.includes(q);
  });
  const col = COLUMNS.find((c) => c.key === sortKey) || COLUMNS[0];
  list.sort((a, b) => {
    const va = String(col.get(a) ?? '');
    const vb = String(col.get(b) ?? '');
    return va.localeCompare(vb, 'fr', { numeric: true }) * sortDir;
  });
  return list;
}

function renderTable() {
  const table = $('#table');
  const list = filteredBooks();
  $('#table-count').textContent = `${num(list.length)} livre(s) sur ${num(state.books.length)} — chargé le ${fmtDate(state.loadedAt)}`;

  table.innerHTML = '';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  COLUMNS.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c.label + (sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
    th.addEventListener('click', () => {
      if (sortKey === c.key) sortDir = -sortDir;
      else { sortKey = c.key; sortDir = 1; }
      renderTable();
    });
    tr.append(th);
  });
  thead.append(tr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  list.forEach((b) => {
    const row = document.createElement('tr');
    COLUMNS.forEach((c) => {
      const td = document.createElement('td');
      const value = c.get(b);
      td.textContent = c.key === 'rating' ? (value ? '★'.repeat(value) : '—') : String(value);
      if (c.num) td.className = 'num';
      row.append(td);
    });
    tbody.append(row);
  });
  table.append(tbody);
}

function buildFilterOptions() {
  const rooms = [...new Set(state.locations.map((l) => l.room).filter(Boolean))].sort();
  const roomSel = $('#filter-room');
  roomSel.innerHTML = '<option value="">Toutes les pièces</option>';
  rooms.forEach((r) => roomSel.append(new Option(r, r)));

  const tagSel = $('#filter-tag');
  tagSel.innerHTML = '<option value="">Toutes les étiquettes</option>';
  state.tags.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .forEach((t) => tagSel.append(new Option(t.name, t.id)));
}

/* ----------------------------- classification ---------------------------- */

function groupValue(book, by) {
  switch (by) {
    case 'room': return roomOf(book);
    case 'shelf': return shelfOf(book);
    case 'tag': {
      const names = (book.tagIds || []).map((id) => tagById.get(id)?.name).filter(Boolean);
      return names.length ? names.join(', ') : '—';
    }
    case 'author': return authorOf(book);
    case 'publisher': return book.publisher || '—';
    case 'year': return book.year || '—';
    case 'language': return book.language || '—';
    case 'rating': return book.rating ? `${book.rating}★` : 'Non noté';
    case 'source': return book.source || 'manual';
    default: return '—';
  }
}

function renderGroups() {
  const by = $('#group-by').value;
  const desc = $('#group-desc').checked;
  const map = new Map();
  state.books.forEach((b) => {
    const key = groupValue(b, by);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  });
  const entries = [...map.entries()].sort((a, b) => (desc ? b[1].length - a[1].length : a[0].localeCompare(b[0], 'fr')));

  const host = $('#groups');
  host.innerHTML = '';
  if (!entries.length) {
    host.innerHTML = '<p class="muted">Aucun livre à classer.</p>';
    return;
  }
  entries.forEach(([key, books], i) => {
    const group = document.createElement('div');
    group.className = 'tree__group';
    const head = document.createElement('div');
    head.className = 'tree__head';
    head.innerHTML = `<span>${key}</span><span class="tree__count">${books.length}</span>`;
    const body = document.createElement('div');
    body.className = 'tree__body';
    body.hidden = i > 2;
    books.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'book-row';
      row.innerHTML = `<div class="book-row__main">
          <div class="book-row__title">${b.title || '—'}</div>
          <div class="book-row__author">${authorOf(b)}${b.publisher ? ' · ' + b.publisher : ''}${b.year ? ' · ' + b.year : ''}</div>
        </div>
        <div class="book-row__right small muted">${shelfOf(b)}</div>`;
      body.append(row);
    });
    head.addEventListener('click', () => { body.hidden = !body.hidden; });
    group.append(head, body);
    host.append(group);
  });
}

/* ------------------------------ data quality ---------------------------- */

function renderQuality() {
  const host = $('#quality');
  host.innerHTML = '';

  const dupes = new Map();
  state.books.forEach((b) => {
    const key = b.isbn13 || b.isbn10;
    if (!key) return;
    if (!dupes.has(key)) dupes.set(key, []);
    dupes.get(key).push(b);
  });
  const dupeList = [...dupes.entries()].filter(([, list]) => list.length > 1);

  const checks = [
    { label: 'Sans couverture', books: state.books.filter((b) => !b.coverUrl) },
    { label: 'Sans note', books: state.books.filter((b) => !b.rating) },
    { label: 'Sans emplacement', books: state.books.filter((b) => !b.locationId) },
    { label: 'Sans ISBN', books: state.books.filter((b) => !b.isbn13 && !b.isbn10) },
    { label: 'Sans éditeur', books: state.books.filter((b) => !b.publisher) },
    { label: 'Sans année', books: state.books.filter((b) => !b.year) },
    { label: 'Sans étiquette', books: state.books.filter((b) => !(b.tagIds || []).length) },
  ];

  const card = document.createElement('div');
  card.className = 'card card--pad';
  card.innerHTML = '<div class="section__title">Audit des métadonnées</div>';
  const list = document.createElement('div');
  checks.forEach((c) => {
    const line = document.createElement('div');
    line.className = 'stat-line';
    line.innerHTML = `<span>${c.label}</span><span class="stat-line__value">${c.books.length}</span>`;
    list.append(line);
  });
  card.append(list);
  host.append(card);

  if (dupeList.length) {
    const dup = document.createElement('div');
    dup.className = 'card card--pad';
    dup.style.marginTop = '14px';
    dup.innerHTML = '<div class="section__title">ISBN en double</div>';
    dupeList.forEach(([key, books]) => {
      const line = document.createElement('div');
      line.className = 'stat-line';
      line.innerHTML = `<span>${key} — ${books.map((b) => b.title).join(' / ')}</span><span class="stat-line__value">${books.length}</span>`;
      dup.append(line);
    });
    host.append(dup);
  }
}

/* -------------------------------- stats -------------------------------- */

function renderStats() {
  const host = $('#stats-charts');
  host.innerHTML = '';
  const p = palette();
  const byRoom = tally(state.books.map(roomOf));
  const byTag = tally(state.books.flatMap((b) => (b.tagIds || []).map((id) => tagById.get(id)?.name).filter(Boolean)));
  const byYear = tally(state.books.map((b) => b.year).filter(Boolean));
  const byLang = tally(state.books.map((b) => b.language).filter(Boolean));
  const byRating = tally(state.books.map((b) => (b.rating ? `${b.rating}★` : 'Non noté')));

  const cards = [
    { title: 'Livres par pièce', body: barChart, data: byRoom },
    { title: 'Pareto des étiquettes', body: paretoChart, data: byTag.slice(0, 12) },
    { title: 'Livres par année', body: barChart, data: byYear },
    { title: 'Répartition des notes', body: donutChart, data: byRating },
    { title: 'Langues', body: hBarChart, data: byLang },
  ];

  cards.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'card card--pad';
    card.innerHTML = `<h3 style="font-size:.95rem;margin-bottom:10px">${c.title}</h3>`;
    const chart = document.createElement('div');
    chart.className = 'chart';
    card.append(chart);
    host.append(card);
    requestAnimationFrame(() => {
      const data = c.data.map((d, i) => ({ ...d, color: p.series[i % p.series.length] }));
      if (c.body === paretoChart) c.body(chart, data.map((d) => ({ ...d, color: p.primary })), {});
      else c.body(chart, data, {});
    });
  });
}

function tally(values) {
  const map = new Map();
  values.forEach((v) => map.set(v, (map.get(v) || 0) + 1));
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/* ------------------------------- exports ------------------------------- */

function exportXlsx() {
  const rows = filteredBooks().map((b) => [
    b.title || '', b.subtitle || '', (b.authors || []).join(' ; '), b.isbn13 || b.isbn10 || '',
    b.publisher || '', b.year || '', b.language || '', b.pages || '', b.collection || '', b.dewey || '',
    roomOf(b), shelfOf(b), (b.tagIds || []).map((id) => tagById.get(id)?.name).filter(Boolean).join(' ; '),
    b.rating || 0, b.source || '', b.coverUrl || '', b.catalogueUrl || '', b.notes || '',
    String(b.addedAt || '').slice(0, 10), String(b.updatedAt || '').slice(0, 10),
  ]);
  const blob = buildWorkbook([{
    name: 'Livres',
    title: 'Inventaire — export laptop',
    subtitle: `${rows.length} livre(s)`,
    columns: [
      { header: 'Titre', width: 46 }, { header: 'Sous-titre', width: 30 }, { header: 'Auteurs', width: 30 },
      { header: 'ISBN', width: 16 }, { header: 'Éditeur', width: 24 }, { header: 'Année', width: 9 },
      { header: 'Langue', width: 9 }, { header: 'Pages', width: 8 }, { header: 'Collection', width: 24 },
      { header: 'Classification', width: 14 }, { header: 'Pièce', width: 16 }, { header: 'Étagère', width: 20 },
      { header: 'Étiquettes', width: 26 }, { header: 'Note', width: 7 }, { header: 'Source', width: 14 },
      { header: 'Couverture', width: 38 }, { header: 'Notice', width: 36 }, { header: 'Notes', width: 34 },
      { header: 'Ajouté le', width: 12 }, { header: 'Modifié le', width: 12 },
    ],
    rows,
  }], { title: 'Bookish — export' });
  download(blob, 'books-classified.xlsx');
  toast('Export .xlsx généré', 'success');
}

function exportCsv() {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = COLUMNS.map((c) => esc(c.label)).join(';');
  const lines = filteredBooks().map((b) => COLUMNS.map((c) => esc(c.get(b))).join(';'));
  const blob = new Blob([`﻿${header}\r\n${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  download(blob, 'books-classified.csv');
  toast('Export .csv généré', 'success');
}

/* -------------------------------- wiring -------------------------------- */

$('#btn-connect').addEventListener('click', () => {
  const clientId = $('#client-id').value.trim() || localStorage.getItem('bookish.clientId') || '';
  if (!clientId) { toast('Renseignez l’ID client OAuth', 'error'); return; }
  localStorage.setItem('bookish.clientId', clientId);
  connect(clientId).catch((err) => toast(err.message, 'error'));
});

$('#btn-pull').addEventListener('click', pull);
$('#btn-load-local').addEventListener('click', () => $('#file-json').click());
$('#file-json').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    loadData(data);
    setStatus(`Fichier local · ${fmtDate(new Date())}`, 'is-ok');
    toast(`${num(state.books.length)} livre(s) chargés`, 'success');
  } catch (err) {
    toast(`Fichier invalide : ${err.message}`, 'error');
  }
});

$('#q').addEventListener('input', renderTable);
$('#filter-room').addEventListener('change', renderTable);
$('#filter-tag').addEventListener('change', renderTable);
$('#group-by').addEventListener('change', renderGroups);
$('#group-desc').addEventListener('change', renderGroups);
$('#btn-export-xlsx').addEventListener('click', exportXlsx);
$('#btn-export-csv').addEventListener('click', exportCsv);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
    tab.setAttribute('aria-selected', 'true');
    ['table', 'groups', 'quality', 'stats'].forEach((id) => {
      $(`#tab-${id}`).classList.toggle('hidden', id !== tab.dataset.tab);
    });
    if (tab.dataset.tab === 'stats') renderStats();
  });
});

$('#auto-refresh').addEventListener('change', (e) => {
  if (e.currentTarget.checked) {
    setInterval(() => { if (state.token) pull(); }, 5 * 60 * 1000);
    toast('Actualisation automatique activée (5 min)');
  }
});

// Restore the client id from a previous session.
$('#client-id').value = localStorage.getItem('bookish.clientId') || '';
setStatus(state.token ? 'Connecté' : 'Non connecté');

// Small handle for automated tests (tools/laptest.html) and for debugging
// from the browser console.
window.bookishLaptop = {
  state,
  loadData,
  renderTable,
  renderGroups,
  renderQuality,
  renderStats,
  filteredBooks,
  exportXlsx,
  exportCsv,
};
