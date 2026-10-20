/**
 * Drive synchronisation orchestrator.
 * Pushes the inventory (xlsx + json) to Google Drive and keeps the file ids
 * in the settings so subsequent syncs update the same files.
 */
import { t } from './strings.js';
import * as store from './store.js';
import * as drive from './drive.js';
import { computeStats } from './stats.js';

let busy = false;
const listeners = new Set();

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status) {
  listeners.forEach((fn) => {
    try { fn(status); } catch (e) { console.error(e); }
  });
}

export function isSyncing() {
  return busy;
}

/**
 * Push the library to Google Drive.
 * @param {{interactive?:boolean}} opts interactive=true shows Google consent
 * @returns {Promise<{ok:boolean, error?:string, count?:number}>}
 */
export async function syncToDrive({ interactive = false } = {}) {
  const settings = store.state.settings;
  if (busy) return { ok: false, error: 'busy' };
  if (!settings.googleClientId) {
    const msg = t('settings.oauthId');
    if (interactive) emit({ state: 'error', message: msg });
    return { ok: false, error: 'missing-client-id', message: msg };
  }

  busy = true;
  emit({ state: 'start' });
  try {
    await drive.initGoogle(settings.googleClientId);
    const token = await drive.getToken({ interactive });
    const stats = computeStats();
    const result = await drive.pushInventory({
      books: store.state.books,
      locations: store.state.locations,
      tags: store.state.tags,
      stats,
      fileName: settings.driveFileName || 'books-inventory.xlsx',
      folderId: settings.driveFolderId || '',
      xlsxFileId: settings.driveFileId || '',
      jsonFileId: settings.driveJsonFileId || '',
      token,
    });
    await store.updateSetting('driveFileId', result.xlsx.id);
    await store.updateSetting('driveJsonFileId', result.json.id);
    await store.updateSetting('lastSyncAt', new Date().toISOString());
    emit({ state: 'success', count: store.state.books.length });
    return { ok: true, count: store.state.books.length, result };
  } catch (err) {
    const message = String(err?.message || err);
    emit({ state: 'error', message });
    return { ok: false, error: message };
  } finally {
    busy = false;
  }
}

/** Fire-and-forget sync used after every change (when auto-sync is on). */
let pending = null;
export function scheduleAutoSync() {
  const settings = store.state.settings;
  if (!settings.driveEnabled || !settings.driveAutoSync) return;
  if (!settings.googleClientId) return;
  clearTimeout(pending);
  pending = setTimeout(async () => {
    const res = await syncToDrive({ interactive: false });
    if (res.ok) emit({ state: 'auto-success', count: res.count });
  }, 4000);
}
