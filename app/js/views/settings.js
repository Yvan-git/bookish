/**
 * Settings view — appearance, API keys, Google Drive sync, locations & tags
 * management, data import/export.
 */
import { t, setLang, getLang, onLangChange } from '../strings.js';
import { el, icon, toast, confirmDialog, fmtDate, downloadBlob, openSheet } from '../util.js';
import * as store from '../store.js';
import { testGoogleApiKey, testBnf } from '../apis.js';
import { buildInventoryWorkbook } from '../../../shared/xlsx.js';
import { computeStats } from '../stats.js';
import { syncToDrive, onSyncStatus } from '../sync.js';
import { openLocationCreator } from './shared.js';

export function renderSettings(root, { onChanged, onThemeChanged, onLangChanged }) {
  const view = el('div', { class: 'view view--settings' });
  root.append(view);
  const host = el('div', {});
  view.append(host);

  function paint() {
    host.innerHTML = '';
    const s = store.state.settings;

    /* ---------------------------- appearance --------------------------- */
    host.append(section(t('settings.appearance'), [
      row(
        t('settings.theme'),
        select(
          [
            ['auto', t('settings.themeAuto')],
            ['light', t('settings.themeLight')],
            ['dark', t('settings.themeDark')],
          ],
          s.theme || 'auto',
          async (v) => { await store.updateSetting('theme', v); onThemeChanged(); },
        ),
      ),
      row(
        t('settings.language'),
        select([['fr', 'Français'], ['en', 'English']], getLang(), (v) => { setLang(v); onLangChanged(); paint(); }),
      ),
      row(
        t('settings.defaultLocation'),
        select(
          [['', '—'], ...store.state.locations.map((l) => [l.id, store.locationLabel(l)])],
          s.defaultLocationId || '',
          async (v) => { await store.updateSetting('defaultLocationId', v); },
        ),
      ),
    ]));

    /* ------------------------------ API keys --------------------------- */
    const gbInput = el('input', {
      class: 'input', type: 'password', value: s.googleBooksApiKey || '',
      placeholder: 'AIza…', autocomplete: 'off',
      oninput: debounceSave((e) => store.updateSetting('googleBooksApiKey', e.currentTarget.value.trim()), 600),
    });
    const testBtn = el('button', {
      class: 'btn btn--secondary btn--sm', type: 'button',
      onclick: async () => {
        testBtn.disabled = true;
        const original = testBtn.textContent;
        testBtn.textContent = t('common.loading');
        const res = await testGoogleApiKey(s.googleBooksApiKey);
        testBtn.disabled = false;
        testBtn.textContent = original;
        if (res.ok) toast(t('settings.keyOk', { n: res.count }), 'success');
        else toast(t('settings.keyFail', { msg: res.message }), 'error');
      },
    }, t('settings.testKey'));

    const oauthInput = el('input', {
      class: 'input', type: 'text', value: s.googleClientId || '',
      placeholder: '1234567890-abcdef.apps.googleusercontent.com', autocomplete: 'off',
      oninput: debounceSave((e) => store.updateSetting('googleClientId', e.currentTarget.value.trim()), 600),
    });

    host.append(section(t('settings.apis'), [
      row(t('settings.gbKey'), gbInput, t('settings.gbKeyHelp'), testBtn),
      row(t('settings.oauthId'), oauthInput, t('settings.oauthHelp')),
    ]));

    /* -------------------------------- Drive ---------------------------- */
    const fileNameInput = el('input', {
      class: 'input', type: 'text', value: s.driveFileName || 'books-inventory.xlsx',
      oninput: debounceSave((e) => store.updateSetting('driveFileName', e.currentTarget.value.trim() || 'books-inventory.xlsx'), 600),
    });
    const folderInput = el('input', {
      class: 'input', type: 'text', value: s.driveFolderId || '',
      placeholder: '1AbCdEf…',
      oninput: debounceSave((e) => store.updateSetting('driveFolderId', e.currentTarget.value.trim()), 600),
    });

    const syncStatus = el('div', { class: 'tiny muted' });
    const updateSyncStatus = () => {
      const last = store.state.settings.lastSyncAt;
      syncStatus.textContent = last ? t('settings.driveLast', { date: fmtDate(last, true) }) : '';
    };
    updateSyncStatus();

    const syncBtn = el('button', {
      class: 'btn btn--primary btn--sm', type: 'button',
      onclick: async () => {
        syncBtn.disabled = true;
        syncBtn.textContent = t('settings.driveSigningIn');
        const res = await syncToDrive({ interactive: true });
        syncBtn.disabled = false;
        syncBtn.textContent = t('settings.driveSyncNow');
        if (res.ok) toast(t('settings.driveOk', { n: res.count }), 'success');
        else toast(t('settings.driveFail', { msg: res.message || res.error }), 'error');
        updateSyncStatus();
      },
    }, icon('cloud', 15), t('settings.driveSyncNow'));

    const autoSwitch = switchEl(!!s.driveEnabled, async (v) => {
      await store.updateSetting('driveEnabled', v);
      paint();
    });

    host.append(section(t('settings.drive'), [
      row(t('settings.driveEnabled'), autoSwitch, t('settings.driveEnabledHelp')),
      row(t('settings.driveFileName'), fileNameInput),
      row(t('settings.driveFolder'), folderInput),
      el('div', { class: 'setting-row' },
        el('div', { class: 'setting-row__main' },
          el('div', { class: 'row', style: { gap: '8px' } }, syncBtn),
          el('div', { style: { marginTop: '6px' } }, syncStatus))),
    ]));

    const off = onSyncStatus((status) => {
      if (status.state === 'start') syncStatus.textContent = t('settings.driveSigningIn');
      if (status.state === 'success') syncStatus.textContent = t('settings.driveLast', { date: fmtDate(new Date(), true) });
      if (status.state === 'error') syncStatus.textContent = t('settings.driveFail', { msg: status.message });
    });
    view.addEventListener('view:destroy', off);

    /* -------------------------- locations & tags ----------------------- */
    const locRows = store.state.locations.map((loc) => el('div', { class: 'setting-row' },
      el('div', { class: 'setting-row__main' },
        el('div', { class: 'setting-row__title' }, store.locationLabel(loc)),
        el('div', { class: 'setting-row__desc' }, [loc.room, loc.zone, loc.shelf, loc.position].filter(Boolean).join(' › '))),
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': t('common.edit'),
        onclick: () => openLocationEditor(loc),
      }, icon('edit', 17)),
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': t('common.delete'),
        onclick: async () => {
          const ok = await confirmDialog({
            title: t('common.delete'),
            message: `${store.locationLabel(loc)} — ${t('library.deleteConfirm', { title: store.locationLabel(loc) })}`,
          });
          if (!ok) return;
          await store.deleteLocation(loc.id);
          paint();
        },
      }, icon('trash', 17)),
    ));

    const tagRows = store.state.tags.map((tag) => {
      const count = store.state.books.filter((b) => (b.tagIds || []).includes(tag.id)).length;
      return el('div', { class: 'setting-row' },
        el('div', { class: 'setting-row__main' },
          el('div', { class: 'setting-row__title' }, tag.name),
          el('div', { class: 'setting-row__desc' }, `${tag.category ? tag.category + ' · ' : ''}${count} ${t('common.books')}`)),
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': t('common.edit'),
          onclick: () => openTagEditor(tag),
        }, icon('edit', 17)),
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': t('common.delete'),
          onclick: async () => {
            const ok = await confirmDialog({ title: t('common.delete'), message: tag.name });
            if (!ok) return;
            await store.deleteTag(tag.id);
            paint();
          },
        }, icon('trash', 17)),
      );
    });

    host.append(section(t('location.label'), [
      ...locRows,
      el('button', {
        class: 'btn btn--secondary btn--sm', type: 'button', style: { marginTop: '10px' },
        onclick: () => openLocationCreator({ onCreated: () => paint() }),
      }, icon('plus', 15), t('location.new')),
    ]));

    host.append(section(t('tag.tags'), [
      ...tagRows,
      el('button', {
        class: 'btn btn--secondary btn--sm', type: 'button', style: { marginTop: '10px' },
        onclick: () => openTagEditor(),
      }, icon('plus', 15), t('tag.new')),
    ]));

    /* -------------------------------- data ----------------------------- */
    const fileInput = el('input', {
      type: 'file', accept: 'application/json,.json', style: { display: 'none' },
      onchange: async (e) => {
        const file = e.currentTarget.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const n = await store.importSnapshot(data);
          toast(t('settings.importOk', { n }), 'success');
          paint();
          if (onChanged) onChanged();
        } catch (err) {
          toast(t('settings.importFail', { msg: err.message || err }), 'error');
        }
        e.currentTarget.value = '';
      },
    });

    host.append(section(t('settings.data'), [
      el('div', { class: 'row row--wrap', style: { gap: '8px', marginTop: '10px' } },
        el('button', {
          class: 'btn btn--secondary btn--sm', type: 'button',
          onclick: () => {
            const stats = computeStats();
            const blob = buildInventoryWorkbook({
              books: store.state.books,
              locations: store.state.locations,
              tags: store.state.tags,
              stats,
            });
            downloadBlob(blob, store.state.settings.driveFileName || 'books-inventory.xlsx');
          },
        }, icon('download', 15), t('settings.exportXlsx')),
        el('button', {
          class: 'btn btn--secondary btn--sm', type: 'button',
          onclick: () => {
            const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: 'application/json' });
            downloadBlob(blob, 'books-inventory.json');
          },
        }, icon('download', 15), t('settings.exportJson')),
        el('button', {
          class: 'btn btn--secondary btn--sm', type: 'button',
          onclick: () => fileInput.click(),
        }, icon('upload', 15), t('settings.importJson')),
        fileInput,
        el('button', {
          class: 'btn btn--danger btn--sm', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: t('settings.clearAll'), message: t('settings.clearAllConfirm') });
            if (!ok) return;
            await store.clearAllData();
            toast(t('common.done'), 'success');
            paint();
            if (onChanged) onChanged();
          },
        }, icon('trash', 15), t('settings.clearAll')),
      ),
      el('p', { class: 'tiny muted', style: { marginTop: '10px' } }, t('settings.storageHint')),
    ]));

    /* ------------------------------- about ----------------------------- */
    host.append(section(t('settings.about'), [
      el('div', { class: 'setting-row' },
        el('div', { class: 'setting-row__main' },
          el('div', { class: 'setting-row__title' }, 'Bookish'),
          el('div', { class: 'setting-row__desc' }, `${t('settings.version')} 1.0.0 · ${t('app.tagline')}`))),
      el('div', { class: 'setting-row' },
        el('div', { class: 'setting-row__main' },
          el('div', { class: 'setting-row__title' }, 'Sources de métadonnées'),
          el('div', { class: 'setting-row__desc' },
            'catalogue.bnf.fr (SRU) · Google Books API',
            el('span', { class: 'row', style: { gap: '6px', marginTop: '4px' } },
              (() => {
                const b = el('span', { class: 'badge' }, 'test…');
                testBnf().then((r) => {
                  b.className = `badge badge--${r.ok ? 'ok' : 'danger'}`;
                  b.textContent = `BnF ${r.ok ? 'OK' : 'KO'}`;
                });
                return b;
              })(),
              (() => {
                const g = el('span', { class: 'badge' }, 'Google…');
                testGoogleApiKey(store.state.settings.googleBooksApiKey).then((r) => {
                  g.className = `badge badge--${r.ok ? 'ok' : 'warn'}`;
                  g.textContent = r.ok ? `Google OK (${r.count})` : 'Google sans clé';
                });
                return g;
              })(),
            )))),
    ]));
  }

  /* ----------------------------- sub-editors ---------------------------- */

  function openLocationEditor(loc) {
    const values = { room: loc.room, zone: loc.zone, shelf: loc.shelf, position: loc.position };
    const fields = ['room', 'zone', 'shelf', 'position'].map((key) => el('label', { class: 'field' },
      el('span', { class: 'field__label' }, t(`location.${key}`)),
      el('input', {
        class: 'input', type: 'text', value: values[key],
        oninput: (e) => { values[key] = e.currentTarget.value; },
      })));
    const save = el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        await store.updateLocation(loc.id, values);
        sheet.close();
        toast(t('common.done'), 'success');
        paint();
      },
    }, t('common.save'));
    const sheet = openSheet({ title: t('location.label'), content: el('div', {}, ...fields), actions: [save] });
  }

  function openTagEditor(tag) {
    const name = el('input', { class: 'input', type: 'text', value: tag?.name || '' });
    const category = el('input', { class: 'input', type: 'text', value: tag?.category || '' });
    const save = el('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        const value = name.value.trim();
        if (!value) { toast(t('tag.name'), 'error'); return; }
        if (tag) await store.updateTag(tag.id, { name: value, category: category.value.trim() });
        else await store.addTag({ name: value, category: category.value.trim() });
        sheet.close();
        toast(t('common.done'), 'success');
        paint();
      },
    }, t('common.save'));
    const sheet = openSheet({
      title: tag ? t('common.edit') : t('tag.new'),
      content: el('div', {},
        el('label', { class: 'field' }, el('span', { class: 'field__label' }, t('tag.name')), name),
        el('label', { class: 'field' }, el('span', { class: 'field__label' }, t('tag.category')), category)),
      actions: [save],
    });
  }

  paint();
  return () => {};
}

/* ------------------------------- helpers ------------------------------- */

function section(title, children) {
  return el('div', { class: 'card card--pad', style: { marginBottom: '14px' } },
    el('div', { class: 'section__title' }, title),
    ...children.filter(Boolean));
}

function row(title, control, desc, extra) {
  return el('div', { class: 'setting-row' },
    el('div', { class: 'setting-row__main' },
      el('div', { class: 'setting-row__title' }, title),
      desc ? el('div', { class: 'setting-row__desc' }, desc) : null),
    control || null,
    extra || null);
}

function select(options, value, onChange) {
  const sel = el('select', {
    class: 'select', style: { maxWidth: '220px' },
    onchange: (e) => onChange(e.currentTarget.value),
  }, options.map(([v, label]) => el('option', { value: v }, label)));
  sel.value = value;
  return sel;
}

function switchEl(checked, onChange) {
  const btn = el('button', {
    class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(checked),
  });
  btn.addEventListener('click', async () => {
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(next));
    await onChange(next);
  });
  return btn;
}

function debounceSave(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
