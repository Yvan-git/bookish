/**
 * Google Drive synchronisation.
 *
 * Uses the Google Identity Services token client (no SDK, no redirect) to
 * obtain an access token for the `drive.file` scope, then uploads:
 *   - <name>.xlsx  the human-readable inventory workbook
 *   - <name>.json  the machine-readable snapshot used by the laptop workspace
 *
 * The access token is kept in memory and refreshed on demand; the user only
 * has to consent once per browser session.
 */
import { buildInventoryWorkbook } from '../../shared/xlsx.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

let gisReady = null;
let tokenClient = null;
let accessToken = '';
let tokenExpiresAt = 0;

function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(window.google); return; }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.google?.accounts?.oauth2
      ? resolve(window.google)
      : reject(new Error('GIS unavailable')));
    script.onerror = () => reject(new Error('GIS unavailable (offline?)'));
    document.head.append(script);
  });
  return gisReady;
}

/** Initialise (or re-initialise) the token client for a given client ID. */
export async function initGoogle(clientId) {
  if (!clientId) throw new Error('missing-client-id');
  const google = await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (response) => {
      if (response.error) throw new Error(response.error);
      accessToken = response.access_token || '';
      tokenExpiresAt = Date.now() + 55 * 60 * 1000;
      if (driveTokenResolve) driveTokenResolve(accessToken);
    },
  });
  return true;
}

let driveTokenResolve = null;
let driveTokenReject = null;

/** Ask the user for consent and return an access token. */
export function requestToken({ prompt = 'consent' } = {}) {
  if (!tokenClient) return Promise.reject(new Error('missing-client-id'));
  return new Promise((resolve, reject) => {
    driveTokenResolve = resolve;
    driveTokenReject = reject;
    try {
      tokenClient.requestAccessToken({ prompt });
    } catch (err) {
      reject(err);
    }
  });
}

/** Return a valid access token, refreshing it when needed. */
export async function getToken({ interactive = false } = {}) {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  try {
    return await requestToken({ prompt: interactive ? 'consent' : '' });
  } catch (err) {
    if (interactive) throw err;
    // Silent renewal failed → ask the user explicitly.
    return requestToken({ prompt: 'consent' });
  }
}

export function isConnected() {
  return Boolean(accessToken);
}

export function disconnect() {
  accessToken = '';
  tokenExpiresAt = 0;
}

async function driveFetch(url, { method = 'GET', body = null, headers = {}, token = '' } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j?.error?.message || JSON.stringify(j).slice(0, 200);
    } catch (_) {
      detail = await res.text().catch(() => '');
      detail = String(detail).slice(0, 200);
    }
    throw new Error(`drive-${res.status}:${detail}`);
  }
  return res;
}

/** Find a file by name (exact match, not trashed). */
export async function findFileByName(name, token) {
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and trashed = false`);
  const url = `${DRIVE_API}/files?q=${q}&spaces=drive&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,size)')}&pageSize=10`;
  const res = await driveFetch(url, { token });
  const json = await res.json();
  return (json.files || [])[0] || null;
}

/** Upload or update a file. Returns the Drive file object. */
export async function uploadFile({ fileId, name, blob, mimeType, folderId = '', token }) {
  const metadata = { name, mimeType };
  if (folderId) metadata.parents = [folderId];
  const boundary = 'bookish_boundary_' + Date.now().toString(36);
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const body = new Blob([pre, blob, post], { type: `multipart/related; boundary=${boundary}` });

  const url = fileId
    ? `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${encodeURIComponent('id,name,modifiedTime,size')}`
    : `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${encodeURIComponent('id,name,modifiedTime,size')}`;
  const res = await driveFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    body,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    token,
  });
  return res.json();
}

/** Download a Drive file as a Blob. */
export async function downloadFile(fileId, token) {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await driveFetch(url, { token });
  return res.blob();
}

/**
 * Push the current inventory to Google Drive.
 * @param {{books, locations, tags, stats, fileName, folderId, xlsxFileId, jsonFileId, token}} input
 */
export async function pushInventory(input) {
  const {
    books, locations, tags, stats,
    fileName = 'books-inventory.xlsx',
    folderId = '',
    xlsxFileId = '', jsonFileId = '',
    token,
  } = input;

  const xlsxBlob = buildInventoryWorkbook({ books, locations, tags, stats });
  const jsonBlob = new Blob([JSON.stringify({
    format: 'bookish-inventory',
    version: 1,
    exportedAt: new Date().toISOString(),
    books, locations, tags,
  }, null, 2)], { type: 'application/json' });

  const jsonName = fileName.replace(/\.xlsx$/i, '') + '.json';

  let xlsxResult = null;
  let jsonResult = null;

  if (xlsxFileId) {
    xlsxResult = await uploadFile({ fileId: xlsxFileId, name: fileName, blob: xlsxBlob, mimeType: xlsxBlob.type, token });
  } else {
    const existing = await findFileByName(fileName, token);
    xlsxResult = await uploadFile({
      fileId: existing?.id || '',
      name: fileName,
      blob: xlsxBlob,
      mimeType: xlsxBlob.type,
      folderId: existing ? '' : folderId,
      token,
    });
  }

  if (jsonFileId) {
    jsonResult = await uploadFile({ fileId: jsonFileId, name: jsonName, blob: jsonBlob, mimeType: 'application/json', token });
  } else {
    const existingJson = await findFileByName(jsonName, token);
    jsonResult = await uploadFile({
      fileId: existingJson?.id || '',
      name: jsonName,
      blob: jsonBlob,
      mimeType: 'application/json',
      folderId: existingJson ? '' : folderId,
      token,
    });
  }

  return {
    xlsx: { id: xlsxResult.id, name: xlsxResult.name, modifiedTime: xlsxResult.modifiedTime, size: xlsxBlob.size },
    json: { id: jsonResult.id, name: jsonResult.name, modifiedTime: jsonResult.modifiedTime, size: jsonBlob.size },
  };
}
