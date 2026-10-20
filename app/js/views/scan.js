/**
 * Scan view — the primary flow.
 *   barcode → BnF / Google Books lookup → editable metadata proposal →
 *   location (defaulted to the last one used) → tags → rating → save.
 */
import { t } from '../strings.js';
import { el, icon, starsEl, toast, openSheet } from '../util.js';
import * as store from '../store.js';
import { lookupIsbn, searchCatalog, toIsbn13, prettyIsbn, normalizeIsbn, isValidIsbn10, isValidIsbn13 } from '../apis.js';
import { Scanner } from '../scanner.js';
import { coverNode, metadataForm, locationPicker, openTagPicker, openBookDetail } from './shared.js';

const state = {
  mode: 'idle',        // idle | loading | proposal | candidates
  proposal: null,      // { model, source, locationId, tagIds, rating, notes }
  candidates: [],
  scanner: null,
};

export function renderScan(root, { onChanged }) {
  const view = el('div', { class: 'view view--scan' });
  root.append(view);

  const panel = el('div', {});
  view.append(panel);

  const paint = () => {
    panel.innerHTML = '';
    if (state.mode === 'proposal') panel.append(proposalPanel(onChanged));
    else if (state.mode === 'candidates') panel.append(candidatesPanel(onChanged));
    else if (state.mode === 'loading') panel.append(loadingPanel());
    else panel.append(idlePanel());
  };

  paint();

  /* --------------------------- idle panel --------------------------- */

  function loadingPanel() {
    return el('div', { class: 'card card--pad', style: { textAlign: 'center' } },
      el('div', { class: 'row', style: { justifyContent: 'center', gap: '10px', marginTop: '8px' } },
        el('span', { class: 'spinner', style: { color: 'var(--primary)' } }),
        el('span', { class: 'strong' }, t('scan.looking'))),
      el('div', { class: 'skeleton', style: { height: '12px', marginTop: '16px' } }),
      el('div', { class: 'skeleton', style: { height: '12px', marginTop: '8px', width: '70%' } }),
      el('div', { class: 'skeleton', style: { height: '12px', marginTop: '8px', width: '85%' } }),
    );
  }

  function idlePanel() {
    const wrap = el('div', {});

    const hero = el('div', { class: 'card card--pad', style: { textAlign: 'center', padding: '22px 16px' } },
      el('div', { class: 'empty__icon', style: { margin: '0 auto 14px', width: '64px', height: '64px' } }, icon('scan', 28)),
      el('h2', { style: { fontSize: '1.2rem' } }, t('scan.title')),
      el('p', { class: 'small muted', style: { marginTop: '4px' } }, t('scan.subtitle')),
      el('button', {
        class: 'btn btn--primary btn--lg', type: 'button', style: { marginTop: '16px' },
        onclick: openScanner,
      }, icon('camera', 18), t('scan.title')),
    );

    // USB / keyboard barcode input
    const wedgeInput = el('input', {
      class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off',
      placeholder: '9782070362518',
      onkeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const raw = e.currentTarget.value.trim();
          e.currentTarget.value = '';
          if (raw) startLookup(raw);
        }
      },
    });
    const wedge = el('div', { class: 'card card--pad' },
      el('div', { class: 'row', style: { marginBottom: '8px' } },
        icon('keyboard', 16),
        el('div', { class: 'setting-row__title' }, t('scan.wedge')),
      ),
      el('p', { class: 'tiny muted', style: { marginBottom: '8px' } }, t('scan.wedgeHint')),
      wedgeInput,
    );

    // Manual entry — an ISBN on its own is enough (old books, no barcode),
    // title/author stays available for books with neither.
    const isbnInput = el('input', {
      class: 'input grow', type: 'text', id: 'manual-isbn',
      inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'search',
      'aria-describedby': 'manual-isbn-hint',
      placeholder: t('scan.manualIsbn'),
    });
    const isbnHint = el('p', { class: 'tiny muted', id: 'manual-isbn-hint', style: { margin: '-2px 0 12px' } }, t('scan.manualIsbnHint'));

    const titleInput = el('input', {
      class: 'input grow', type: 'text', id: 'manual-title',
      placeholder: t('scan.manualTitleOptional'), style: { minWidth: '140px' },
    });
    const authorInput = el('input', {
      class: 'input grow', type: 'text', id: 'manual-author',
      placeholder: t('scan.manualAuthor'), style: { minWidth: '120px' },
    });

    const searchLabel = el('span', {}, t('scan.complete'));

    const refreshIsbnState = () => {
      const raw = isbnInput.value.trim();
      if (!raw) {
        isbnHint.textContent = t('scan.manualIsbnHint');
        isbnHint.className = 'tiny muted';
        searchLabel.textContent = t('scan.complete');
        return;
      }
      const clean = normalizeIsbn(raw);
      if (isValidIsbn13(clean)) {
        isbnHint.textContent = t('scan.isbnValid');
        isbnHint.className = 'tiny ok';
      } else if (isValidIsbn10(clean)) {
        isbnHint.textContent = t('scan.isbnValid10');
        isbnHint.className = 'tiny ok';
      } else {
        isbnHint.textContent = t('scan.isbnInvalid');
        isbnHint.className = 'tiny warn';
      }
      searchLabel.textContent = t('scan.searchByIsbn');
    };

    const submitManual = () => {
      const isbnRaw = isbnInput.value.trim();
      const title = titleInput.value.trim();
      const author = authorInput.value.trim();
      if (isbnRaw) {
        // ISBN alone: look the book up and propose the metadata.
        startLookup(isbnRaw, { title, author });
        return;
      }
      if (!title) {
        toast(t('scan.needIsbnOrTitle'), 'error');
        titleInput.focus();
        return;
      }
      startSearch(title, author);
    };

    const searchBtn = el('button', {
      class: 'btn btn--secondary', type: 'button',
      onclick: () => submitManual(),
    }, icon('search', 16), searchLabel);

    isbnInput.addEventListener('input', refreshIsbnState);
    [isbnInput, titleInput, authorInput].forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitManual(); }
      });
    });

    const manual = el('div', { class: 'card card--pad' },
      el('div', { class: 'row', style: { marginBottom: '8px' } },
        icon('edit', 16),
        el('div', { class: 'setting-row__title' }, t('scan.manual')),
      ),
      el('label', { class: 'field' },
        el('span', { class: 'field__label' }, icon('barcode', 14), t('scan.manualIsbn')),
        isbnInput),
      isbnHint,
      el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        titleInput,
        authorInput,
        searchBtn,
      ),
      el('p', { class: 'tiny muted', style: { marginTop: '10px', marginBottom: '0' } }, t('scan.completeHint')),
    );

    wrap.append(hero, el('div', { class: 'section', style: { marginTop: '16px' } }, wedge), manual);

    // Recently added
    const recent = store.state.books.slice(0, 4);
    if (recent.length) {
      wrap.append(el('div', { class: 'section', style: { marginTop: '18px' } },
        el('div', { class: 'section__title' }, t('nav.library')),
        el('div', { class: 'list' }, recent.map((b) => bookRow(b, onChanged)))));
    }
    return wrap;
  }

  /* -------------------------- proposal panel ------------------------- */

  function proposalPanel(onChanged) {
    const p = state.proposal;
    const form = metadataForm(p.model);

    const coverBox = el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '12px', marginBottom: '14px' } },
      coverNode({ coverUrl: p.model.coverUrl, title: p.model.title }, { width: 74, height: 108 }),
      el('div', { class: 'grow' },
        el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '6px', marginBottom: '6px' } },
          el('span', { class: `badge badge--${p.source === 'bnf' ? 'bnf' : p.source === 'google' ? 'google' : 'manual'}` },
            t(`scan.source.${p.source === 'bnf' ? 'bnf' : p.source === 'google' ? 'google' : 'manual'}`)),
          p.model.isbn13 ? el('span', { class: 'badge' }, prettyIsbn(p.model.isbn13)) : null,
          p.duplicate ? el('span', { class: 'badge badge--warn' }, icon('alert', 12), t('library.duplicate')) : null,
        ),
        el('div', { class: 'section__title', style: { margin: '0' } }, t('scan.proposed')),
      ),
    );

    const locWrap = el('div', {});
    const picker = locationPicker(p.locationId, (id) => { p.locationId = id; });
    locWrap.append(picker);

    const tagChips = el('div', { class: 'chips' });
    const renderTags = () => {
      tagChips.innerHTML = '';
      p.tagIds.forEach((id) => {
        const name = store.tagName(id);
        if (!name) return;
        tagChips.append(el('span', { class: 'chip chip--sm chip--tag' }, icon('tag', 12), name,
          el('button', {
            class: 'chip__x', type: 'button', 'aria-label': `Retirer ${name}`,
            onclick: () => { p.tagIds = p.tagIds.filter((x) => x !== id); renderTags(); },
          }, '×')));
      });
      if (!p.tagIds.length) tagChips.append(el('span', { class: 'tiny muted' }, t('tag.none')));
    };
    renderTags();

    const ratingBox = el('div', { class: 'row' });
    const renderRating = () => {
      ratingBox.innerHTML = '';
      ratingBox.append(
        starsEl(p.rating, { size: 26, onPick: (v) => { p.rating = v; renderRating(); } }),
        el('span', { class: 'tiny muted' }, p.rating ? `${p.rating}/5` : t('rating.unrated')),
      );
    };
    renderRating();

    const notesInput = el('textarea', {
      class: 'textarea', placeholder: t('field.notes'),
      oninput: (e) => { p.notes = e.currentTarget.value; },
    });

    const saveBtn = el('button', {
      class: 'btn btn--primary btn--block btn--lg', type: 'button',
      onclick: async () => {
        const values = form.read();
        const book = {
          ...values,
          notes: p.notes || '',
          locationId: p.locationId,
          tagIds: p.tagIds,
          rating: p.rating,
          source: p.source,
        };
        if (!book.title && !book.isbn13) {
          toast(t('scan.manualTitle'), 'error');
          return;
        }
        saveBtn.disabled = true;
        await store.addBook(book);
        toast(t('common.done'), 'success');
        state.mode = 'idle';
        state.proposal = null;
        paint();
        if (onChanged) onChanged();
      },
    }, icon('save', 18), t('scan.save'));

    return el('div', {},
      coverBox,
      form.node,
      el('div', { class: 'section__title', style: { marginTop: '10px' } }, t('location.label')),
      locWrap,
      el('div', { class: 'section__title', style: { marginTop: '14px' } }, t('tag.tags')),
      tagChips,
      el('button', {
        type: 'button', class: 'btn btn--secondary btn--sm', style: { marginTop: '8px' },
        onclick: () => openTagPicker({ selectedIds: p.tagIds, onChange: (ids) => { p.tagIds = ids; renderTags(); } }),
      }, icon('plus', 15), t('tag.add')),
      el('div', { class: 'section__title', style: { marginTop: '14px' } }, t('rating.title')),
      ratingBox,
      el('div', { class: 'section__title', style: { marginTop: '14px' } }, t('field.notes')),
      notesInput,
      el('div', { class: 'row', style: { marginTop: '16px', gap: '8px' } },
        el('button', {
          class: 'btn btn--ghost', type: 'button', style: { flex: '0 0 auto' },
          onclick: () => { state.mode = 'idle'; state.proposal = null; paint(); },
        }, t('common.cancel')),
        saveBtn),
    );
  }

  /* ------------------------- candidates panel ------------------------- */

  function candidatesPanel(onChanged) {
    const wrap = el('div', {},
      el('div', { class: 'section__title' }, t('scan.candidates')),
      el('div', { class: 'list' }, state.candidates.map((c) => candidateRow(c))),
      el('button', {
        class: 'btn btn--ghost btn--block', type: 'button', style: { marginTop: '10px' },
        onclick: () => { state.mode = 'idle'; state.candidates = []; paint(); },
      }, t('common.cancel')),
    );
    return wrap;

    function candidateRow(c) {
      const row = el('button', {
        class: 'book-row', type: 'button',
        onclick: () => {
          state.proposal = makeProposal(c, c._provider === 'google' ? 'google' : 'bnf');
          state.mode = 'proposal';
          paint();
        },
      },
        coverNode(c, { width: 46, height: 66 }),
        el('div', { class: 'book-row__main' },
          el('div', { class: 'book-row__title' }, c.title || '—'),
          el('div', { class: 'book-row__author' }, (c.authors || []).join(', ') || '—'),
          el('div', { class: 'book-row__meta' },
            el('span', { class: `badge badge--${c._provider === 'google' ? 'google' : 'bnf'}` }, t(`scan.source.${c._provider === 'google' ? 'google' : 'bnf'}`)),
            c.year ? el('span', {}, c.year) : null,
            c.publisher ? el('span', {}, c.publisher) : null)),
      );
      return row;
    }
  }

  /* ------------------------------- actions --------------------------- */

  function makeProposal(candidate, source) {
    const defaults = store.state.settings.defaultLocationId || store.state.settings.lastLocationId || '';
    const duplicate = candidate.isbn13 ? store.findByIsbn(candidate.isbn13) : null;
    return {
      source,
      duplicate,
      locationId: defaults,
      tagIds: [],
      rating: 0,
      notes: '',
      model: {
        title: candidate.title || '',
        subtitle: candidate.subtitle || '',
        authorsText: (candidate.authors || []).join(' ; '),
        publisher: candidate.publisher || '',
        year: candidate.year || '',
        pages: candidate.pages || '',
        language: candidate.language || '',
        collection: candidate.collection || '',
        dewey: candidate.dewey || '',
        isbn13: candidate.isbn13 || candidate.isbn10 || '',
        description: candidate.description || '',
        coverUrl: candidate.coverUrl || '',
        catalogueUrl: candidate.catalogueUrl || '',
        subjects: candidate.subjects || [],
        sourceId: candidate.sourceId || '',
      },
    };
  }

  async function startLookup(raw, fallback = {}) {
    state.mode = 'loading';
    paint();
    const apiKey = store.state.settings.googleBooksApiKey || '';
    try {
      const res = await lookupIsbn(raw, { apiKey });
      if (res.status === 'found') {
        state.proposal = makeProposal(res.book, res.source);
        state.mode = 'proposal';
      } else {
        const isbn13 = toIsbn13(raw);
        state.proposal = makeProposal({
          title: fallback.title || '',
          authors: fallback.author ? [fallback.author] : [],
          isbn13: isbn13 || raw,
        }, 'manual');
        state.mode = 'proposal';
        if (res.warning) toast(`${t('common.error')} — ${res.warning}`, 'error', 5000);
        else toast(t('scan.noCandidate'), 'error');
      }
    } catch (err) {
      state.mode = 'idle';
      toast(`${t('common.error')} — ${err.message || err}`, 'error');
    }
    paint();
  }

  async function startSearch(title, author) {
    state.mode = 'loading';
    paint();
    try {
      const apiKey = store.state.settings.googleBooksApiKey || '';
      const results = await searchCatalog({ title, author, apiKey });
      state.candidates = results;
      state.mode = results.length ? 'candidates' : 'idle';
      if (!results.length) toast(t('scan.noCandidate'), 'error');
    } catch (err) {
      state.mode = 'idle';
      toast(`${t('common.error')} — ${err.message || err}`, 'error');
    }
    paint();
  }

  /* ------------------------------- scanner --------------------------- */

  async function openScanner() {
    const overlay = el('div', { class: 'scanner' });
    const video = el('video', { class: 'scanner__video', playsinline: true, muted: true });
    const status = el('div', { class: 'scanner__status' }, el('span', { class: 'spinner' }), el('span', {}, t('scan.scanning')));

    const frame = el('div', { class: 'scanner__frame' },
      el('span'), el('span'), el('span'), el('span'),
      el('div', { class: 'scanner__line' }));

    const torchBtn = el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': t('scan.torch'), onclick: async () => {
        const on = await scanner?.toggleTorch();
        toast(on ? t('scan.torchOn') : t('scan.torchOff'));
      },
    }, icon('flash', 20));

    const engineBadge = el('span', { class: 'scanner__engine' }, t('scan.engineStarting'));
    const overlayTop = el('div', { class: 'scanner__top' },
      el('div', { class: 'scanner__top-left' },
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('common.close'), onclick: close }, icon('x', 20)),
        engineBadge),
      torchBtn);

    const overlayBottom = el('div', { class: 'scanner__bottom' },
      el('p', { class: 'small', style: { color: '#fff', textAlign: 'center', margin: '0' } }, t('scan.hint')),
      el('button', {
        class: 'btn btn--block', type: 'button',
        onclick: () => { close(); manualFallback(); },
      }, icon('keyboard', 16), t('scan.manual')),
    );

    overlay.append(video, el('div', { class: 'scanner__overlay' }, frame), status, overlayTop, overlayBottom);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-in'));

    const scanner = new Scanner();
    state.scanner = scanner;

    function close() {
      scanner.stop();
      overlay.classList.remove('is-in');
      setTimeout(() => overlay.remove(), 280);
      state.scanner = null;
    }

    function manualFallback() {
      const title = document.getElementById('manual-title');
      if (title) title.focus();
    }

    try {
      const mode = await scanner.start(video, {
        onDetect: async ({ raw, isbn13 }) => {
          status.classList.add('is-visible');
          status.lastChild.textContent = t('scan.scanning');
          close();
          await startLookup(isbn13 || raw);
        },
        onError: () => {},
      });
      if (mode !== 'native') {
        // The native BarcodeDetector API is missing on some desktops (Windows,
        // Linux). The jsQR fallback is already running, so say so clearly.
        const msg = scanner.fallbackReady ? t('scan.jsqrFallback') : t('scan.noBarcodeApi');
        overlayBottom.append(el('p', { class: 'tiny', style: { color: 'rgba(255,255,255,.75)', textAlign: 'center', margin: '0' } }, msg));
      }
      engineBadge.textContent = mode === 'native' ? t('scan.engineNative') : t('scan.engineFallback');
      engineBadge.classList.toggle('scanner__engine--fallback', mode !== 'native');
    } catch (err) {
      close();
      const msg = err?.name === 'NotAllowedError' ? t('scan.cameraDenied') : t('scan.cameraError');
      toast(msg, 'error');
      const sheet = openSheet({
        title: t('scan.manual'),
        content: el('p', { class: 'muted' }, msg),
      });
    }
  }

  /* ------------------------- simulator hook ------------------------- */

  // The desktop simulator injects a scanned code through postMessage.
  const onMessage = async (event) => {
    const data = event.data;
    if (!data || data.type !== 'bookish:simulate-scan') return;
    await startLookup(data.isbn || data.code || '');
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

/** Compact book row reused by several views. */
export function bookRow(book, onChanged) {
  const loc = store.findLocation(book.locationId);
  return el('button', {
    class: 'book-row', type: 'button',
    onclick: () => openBookDetail(book.id, { onChanged }),
  },
    coverNode(book, { width: 46, height: 66 }),
    el('div', { class: 'book-row__main' },
      el('div', { class: 'book-row__title' }, book.title || '—'),
      el('div', { class: 'book-row__author' }, (book.authors || []).join(', ') || '—'),
      el('div', { class: 'book-row__meta' },
        loc ? el('span', { class: 'row', style: { gap: '4px' } }, icon('mapPin', 12), store.locationLabel(loc)) : null,
        book.year ? el('span', {}, book.year) : null,
        el('span', { class: `badge badge--${book.source || 'manual'}` }, t(`scan.source.${book.source === 'bnf' ? 'bnf' : book.source === 'google' ? 'google' : 'manual'}`)),
      )),
    el('div', { class: 'book-row__right' }, starsEl(book.rating || 0, { size: 13 })),
  );
}
