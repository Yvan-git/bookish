/** Small DOM / formatting helpers shared by every view. */
import { t } from './strings.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element with attributes/props and children. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Escape a string for safe innerHTML interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** RFC4122-ish unique id (crypto.randomUUID when available). */
export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function debounce(fn, ms = 220) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    // `event.currentTarget` is reset to null once the dispatch is over, so a
    // debounced handler would read `null.value`. Freeze the reference now.
    const ev = args[0];
    if (ev && typeof ev === 'object' && ev.currentTarget) {
      const captured = ev.currentTarget;
      try {
        Object.defineProperty(ev, 'currentTarget', { configurable: true, get: () => captured });
      } catch { /* frozen event — ignore */ }
    }
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Lowercase + strip diacritics so "Tournier" matches "tournier". */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function fmtDate(d, withTime = false) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const opts = { year: 'numeric', month: 'short', day: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return date.toLocaleDateString(getLangSafe(), opts);
}

function getLangSafe() {
  try {
    return document.documentElement.lang || 'fr';
  } catch (_) {
    return 'fr';
  }
}

export function relativeDate(d) {
  if (!d) return t('common.never');
  const date = d instanceof Date ? d : new Date(d);
  const diff = Date.now() - date.getTime();
  const day = 86400000;
  if (diff < 60000) return t('common.today');
  if (diff < 2 * day) return t('common.yesterday');
  return fmtDate(date);
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Promise-based clipboard copy with a graceful fallback. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Toast notifications, stacked bottom-centre. */
let toastHost = null;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el('div', { class: `toast toast--${kind}` }, message);
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(() => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 320);
  }, ms);
  return node;
}

/** Modal bottom sheet; resolves when closed. */
export function openSheet({ title, content, actions = [], size = 'md' }) {
  const overlay = el('div', { class: 'sheet-overlay' });
  const sheet = el('section', {
    class: `sheet sheet--${size}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': typeof title === 'string' ? title : 'Dialog',
  });
  const head = el('header', { class: 'sheet__head' },
    el('div', { class: 'sheet__handle', 'aria-hidden': 'true' }),
    el('h2', { class: 'sheet__title' }, typeof title === 'string' ? title : ''),
    el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onclick: () => close(),
    }, icon('x')),
  );
  const body = el('div', { class: 'sheet__body' });
  if (content) body.append(content);
  sheet.append(head, body);
  if (actions.length) {
    const foot = el('footer', { class: 'sheet__foot' });
    actions.forEach((a) => foot.append(a));
    sheet.append(foot);
  }
  overlay.append(sheet);
  document.body.append(overlay);
  document.body.classList.add('is-locked');

  function close() {
    overlay.classList.remove('is-in');
    setTimeout(() => {
      overlay.remove();
      if (!document.querySelector('.sheet-overlay')) document.body.classList.remove('is-locked');
    }, 260);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  requestAnimationFrame(() => overlay.classList.add('is-in'));
  const focusable = sheet.querySelector('input, select, textarea, button.btn--primary');
  if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 300);
  return { close, body, sheet };
}

/** Simple confirm dialog built on top of openSheet. */
export function confirmDialog({ title, message, confirmLabel, danger = true }) {
  return new Promise((resolve) => {
    const ok = el('button', {
      class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button',
      onclick: () => { sheet.close(); resolve(true); },
    }, confirmLabel || t('common.confirm'));
    const cancel = el('button', {
      class: 'btn btn--ghost', type: 'button', onclick: () => { sheet.close(); resolve(false); },
    }, t('common.cancel'));
    const sheet = openSheet({
      title,
      content: el('p', { class: 'muted' }, message),
      actions: [cancel, ok],
    });
  });
}

/**
 * Inline SVG icon set (Lucide-style, 24x24 viewBox, currentColor stroke).
 * No emoji, no external icon font, consistent sizing.
 */
const ICONS = {
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M3 12h18"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="4" width="3" height="14" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  sort: '<path d="M11 5h10M11 9h7M11 13h4"/><path d="M3 17h2l3-9 3 9h2"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2c0 .5.2 1 .6 1.4l8.8 8.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  flash: '<path d="M13 2 4.1 12.8a1 1 0 0 0 .8 1.6H11l-1 7.6 8.9-10.8a1 1 0 0 0-.8-1.6H12z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  package: '<path d="m7.5 4.3 9 5.2"/><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
};

/** Build an inline SVG icon element. */
export function icon(name, size = 20, extraClass = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

/** Star rating display / input. */
export function starsEl(value = 0, { size = 16, onPick = null, label = '' } = {}) {
  const wrap = el('span', { class: onPick ? 'stars stars--input' : 'stars', role: onPick ? 'radiogroup' : 'img', 'aria-label': label || `${value}/5` });
  for (let i = 1; i <= 5; i++) {
    const filled = value >= i - 0.25;
    const s = icon('star', size, filled ? 'stars__star is-filled' : 'stars__star');
    if (filled) s.setAttribute('fill', 'currentColor');
    if (onPick) {
      s.classList.add('stars__btn');
      s.setAttribute('role', 'radio');
      s.setAttribute('aria-checked', String(value === i));
      s.setAttribute('tabindex', '0');
      s.setAttribute('aria-label', `${i}`);
      s.style.cursor = 'pointer';
      const pick = (e) => { e.preventDefault(); onPick(i === value ? 0 : i); };
      s.addEventListener('click', pick);
      s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') pick(e); });
    }
    wrap.append(s);
  }
  return wrap;
}

/** Debounced async helper: returns a promise resolving to fn's result. */
export function asyncDebounce(fn, ms = 250) {
  let last = 0;
  return async (...args) => {
    const now = Date.now();
    const wait = Math.max(0, ms - (now - last));
    last = now;
    await new Promise((r) => setTimeout(r, wait));
    return fn(...args);
  };
}

/** Format a number with thin spaces (fr) / commas (en). */
export function num(n) {
  try {
    return new Intl.NumberFormat(getLangSafe()).format(n);
  } catch (_) {
    return String(n);
  }
}

export function bytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1048576).toFixed(1)} Mo`;
}
