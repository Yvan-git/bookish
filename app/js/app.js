/**
 * Application bootstrap: theme, language, routing, service worker and the
 * automatic Google Drive synchronisation.
 */
import { initLang, setLang, onLangChange, t } from './strings.js';
import { el, icon, toast } from './util.js';
import * as store from './store.js';
import { scheduleAutoSync, onSyncStatus } from './sync.js';
import { renderScan } from './views/scan.js';
import { renderLibrary } from './views/library.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';

const VIEWS = {
  scan: { label: 'nav.scan', title: 'scan.title', subtitle: 'scan.subtitle', render: renderScan },
  library: { label: 'nav.library', title: 'library.title', subtitle: 'library.count', render: renderLibrary },
  stats: { label: 'nav.stats', title: 'stats.title', subtitle: 'stats.totalBooks', render: renderStats },
  settings: { label: 'nav.settings', title: 'settings.title', subtitle: 'settings.general', render: renderSettings },
};

let currentView = 'scan';
let cleanupView = null;

/* -------------------------------- theme -------------------------------- */

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#14110f' : '#faf7f2');
}

/* ------------------------------- routing ------------------------------- */

function viewFromHash() {
  const hash = (location.hash || '').replace('#/', '');
  return VIEWS[hash] ? hash : 'scan';
}

function navigate(view) {
  if (!VIEWS[view]) view = 'scan';
  currentView = view;
  if (location.hash !== `#/${view}`) location.hash = `#/${view}`;
  paintView();
}

function paintView() {
  const main = document.getElementById('app-main');
  const def = VIEWS[currentView];
  if (!main) return;

  if (typeof cleanupView === 'function') {
    try { cleanupView(); } catch (_) { /* ignore */ }
  }
  main.innerHTML = '';
  const view = el('div', { class: 'view-wrapper' });
  main.append(view);

  cleanupView = def.render(view, {
    onChanged: () => {
      paintView();
      scheduleAutoSync();
    },
    onThemeChanged: () => applyTheme(store.state.settings.theme),
    onLangChanged: () => {
      paintHeader();
      paintView();
    },
  }) || null;

  paintHeader();
  paintNav();
  main.scrollTop = 0;
}

function paintHeader() {
  const def = VIEWS[currentView];
  const title = document.getElementById('app-title');
  const subtitle = document.getElementById('app-subtitle');
  if (title) title.textContent = t(def.title);
  if (subtitle) {
    if (currentView === 'library') subtitle.textContent = t('library.count', { n: store.state.books.length });
    else if (currentView === 'stats') subtitle.textContent = t('stats.totalBooks') + ' · ' + store.state.books.length;
    else subtitle.textContent = t(def.subtitle);
  }
}

function paintNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    const isActive = btn.dataset.view === currentView;
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

/* --------------------------------- boot -------------------------------- */

async function boot() {
  initLang();

  // Theme: saved preference, else system.
  let savedTheme = 'auto';
  try { savedTheme = localStorage.getItem('bookish.theme') || 'auto'; } catch (_) { /* ignore */ }
  applyTheme(savedTheme);

  const nav = document.getElementById('bottom-nav');
  Object.entries(VIEWS).forEach(([key, def]) => {
    const btn = el('button', {
      class: 'nav-btn', type: 'button', 'data-view': key,
      onclick: () => navigate(key),
    }, icon(key === 'scan' ? 'scan' : key === 'library' ? 'library' : key === 'stats' ? 'chart' : 'settings', 21),
      el('span', {}, t(def.label)));
    nav.append(btn);
  });

  window.addEventListener('hashchange', () => {
    const view = viewFromHash();
    if (view !== currentView) {
      currentView = view;
      paintView();
    }
  });

  onLangChange(() => {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.querySelector('span').textContent = t(VIEWS[btn.dataset.view].label);
    });
  });

  // Media query change → re-apply the "auto" theme.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((store.state.settings.theme || 'auto') === 'auto') applyTheme('auto');
  });

  await store.loadAll();
  applyTheme(store.state.settings.theme || savedTheme);

  // Persist theme preference changes made in the settings view.
  store.onChange(async (reason) => {
    if (reason === 'settings') {
      try { localStorage.setItem('bookish.theme', store.state.settings.theme || 'auto'); } catch (_) { /* ignore */ }
    }
    if (reason === 'books' && store.state.settings.driveEnabled) scheduleAutoSync();
  });

  onSyncStatus((status) => {
    if (status.state === 'auto-success') {
      toast(t('settings.driveOk', { n: status.count }), 'success', 2200);
    }
  });

  navigate(viewFromHash());

  // Service worker (offline support + installability on Android).
  // The worker lives one level up so its scope covers /app/ and /shared/.
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('../sw.js', { scope: '../' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Mise à jour disponible — rechargez la page.', 'info', 4000);
          }
        });
      });
    } catch (err) {
      console.warn('[bookish] SW registration failed', err);
    }
  }
}

/* Expose a tiny API for the desktop simulator (test hooks). */
window.bookish = {
  get state() { return store.state; },
  store,
  navigate,
  syncToDrive: () => import('./sync.js').then((m) => m.syncToDrive({ interactive: true })),
  simulateScan: (isbn) => window.postMessage({ type: 'bookish:simulate-scan', isbn }, '*'),
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
