/**
 * Shared UI pieces used by several views: location picker & creator, tag
 * picker, metadata form, cover thumbnail and the book detail sheet.
 */
import { t } from '../strings.js';
import { el, icon, starsEl, openSheet, confirmDialog, toast, esc, fmtDate } from '../util.js';
import * as store from '../store.js';

/* ------------------------------- cover ------------------------------- */

export function coverNode(book, { width = 52, height = 76 } = {}) {
  const wrap = el('div', { class: 'book-row__cover', style: { width: `${width}px`, height: `${height}px` } });
  if (book.coverUrl) {
    const img = el('img', {
      src: book.coverUrl,
      alt: book.title ? `Couverture de ${book.title}` : 'Couverture',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      onerror: (e) => {
        e.currentTarget.replaceWith(el('div', { class: 'book-row__cover book-row__cover--empty' }, icon('book', Math.round(width * 0.4))));
      },
    });
    wrap.append(img);
  } else {
    wrap.classList.add('book-row__cover--empty');
    wrap.append(icon('book', Math.round(width * 0.4)));
  }
  return wrap;
}

/* ---------------------------- location picker --------------------------- */

/** Inline picker: chips of existing locations + "create" button. */
export function locationPicker(selectedId, onChange) {
  const wrap = el('div', { class: 'location-picker' });
  const render = () => {
    wrap.innerHTML = '';
    const locations = [...store.state.locations].sort((a, b) =>
      store.locationLabel(a).localeCompare(store.locationLabel(b)));
    const chipRow = el('div', { class: 'chips' });
    const selected = store.findLocation(selectedId);
    if (!selected && store.state.locations.length) {
      chipRow.append(el('span', { class: 'chip chip--static chip--sm muted' }, t('location.none')));
    }
    locations.forEach((loc) => {
      const chip = el('button', {
        type: 'button',
        class: 'chip chip--sm',
        'aria-pressed': String(loc.id === selectedId),
        onclick: () => { onChange(loc.id); render(); },
      }, icon('mapPin', 13), store.locationLabel(loc));
      chipRow.append(chip);
    });
    wrap.append(chipRow);
    wrap.append(el('button', {
      type: 'button',
      class: 'btn btn--secondary btn--sm',
      style: { marginTop: '8px' },
      onclick: () => openLocationCreator({
        onCreated: (loc) => { onChange(loc.id); render(); },
      }),
    }, icon('plus', 15), t('location.new')));
  };
  render();
  wrap.refresh = render;
  return wrap;
}

/** Sheet that creates a room › area › shelf › position location. */
export function openLocationCreator({ initial = {}, onCreated } = {}) {
  const values = { room: initial.room || '', zone: initial.zone || '', shelf: initial.shelf || '', position: initial.position || '' };
  const preview = el('div', { class: 'card card--flat card--pad', style: { background: 'var(--surface-2)', marginBottom: '14px' } });

  const updatePreview = () => {
    preview.innerHTML = '';
    preview.append(
      el('div', { class: 'tiny muted', style: { marginBottom: '4px' } }, t('location.label')),
      el('div', { class: 'strong' }, store.locationLabel(values) || t('location.none')),
    );
  };
  updatePreview();

  const mk = (key, label, placeholder, listId) => {
    const input = el('input', {
      class: 'input', type: 'text', value: values[key], placeholder,
      list: listId || '', autocomplete: 'off',
      oninput: (e) => { values[key] = e.currentTarget.value; updatePreview(); },
    });
    return el('label', { class: 'field' },
      el('span', { class: 'field__label' }, label),
      input);
  };

  const rooms = [...new Set(store.state.locations.map((l) => l.room).filter(Boolean))];
  const zones = [...new Set(store.state.locations.map((l) => l.zone).filter(Boolean))];
  const shelves = [...new Set(store.state.locations.map((l) => l.shelf).filter(Boolean))];
  const positions = [...new Set(store.state.locations.map((l) => l.position).filter(Boolean))];

  const datalists = [
    el('datalist', { id: 'dl-rooms' }, rooms.map((r) => el('option', { value: r }))),
    el('datalist', { id: 'dl-zones' }, zones.map((r) => el('option', { value: r }))),
    el('datalist', { id: 'dl-shelves' }, shelves.map((r) => el('option', { value: r }))),
    el('datalist', { id: 'dl-positions' }, positions.map((r) => el('option', { value: r }))),
  ];

  const body = el('div', {},
    preview,
    el('p', { class: 'tiny muted', style: { marginBottom: '12px' } }, t('location.hint'), ' · ', t('location.example')),
    mk('room', t('location.room'), t('location.roomPlaceholder'), 'dl-rooms'),
    mk('zone', t('location.zone'), t('location.zonePlaceholder'), 'dl-zones'),
    mk('shelf', t('location.shelf'), t('location.shelfPlaceholder'), 'dl-shelves'),
    mk('position', t('location.position'), t('location.positionPlaceholder'), 'dl-positions'),
    ...datalists,
  );

  const save = el('button', {
    class: 'btn btn--primary', type: 'button',
    onclick: async () => {
      if (!values.room && !values.shelf) {
        toast(t('location.hint'), 'error');
        return;
      }
      const loc = await store.addLocation(store.makeLocation(values));
      toast(t('location.created'), 'success');
      sheet.close();
      if (onCreated) onCreated(loc);
    },
  }, t('location.create'));

  const sheet = openSheet({ title: t('location.new'), content: body, actions: [save] });
  return sheet;
}

/* ------------------------------ tag picker ----------------------------- */

export function openTagPicker({ selectedIds = [], onChange } = {}) {
  const selected = new Set(selectedIds);
  const list = el('div', { class: 'chips' });

  const render = () => {
    list.innerHTML = '';
    const tags = [...store.state.tags].sort((a, b) => a.name.localeCompare(b.name));
    if (!tags.length) {
      list.append(el('span', { class: 'tiny muted' }, t('tag.none')));
    }
    tags.forEach((tag) => {
      const chip = el('button', {
        type: 'button', class: 'chip chip--sm chip--tag', 'aria-pressed': String(selected.has(tag.id)),
        onclick: () => {
          if (selected.has(tag.id)) selected.delete(tag.id); else selected.add(tag.id);
          render();
          if (onChange) onChange([...selected]);
        },
      }, icon('tag', 12), tag.name);
      list.append(chip);
    });
  };
  render();

  const nameInput = el('input', { class: 'input', type: 'text', placeholder: t('tag.name'), autocomplete: 'off' });
  const catInput = el('input', { class: 'input', type: 'text', placeholder: t('tag.categoryPlaceholder'), autocomplete: 'off' });

  const addBtn = el('button', {
    class: 'btn btn--secondary btn--sm', type: 'button',
    onclick: async () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const tag = await store.addTag({ name, category: catInput.value.trim() });
      if (tag) {
        selected.add(tag.id);
        nameInput.value = '';
        catInput.value = '';
        render();
        if (onChange) onChange([...selected]);
        toast(t('tag.created'), 'success');
      }
    },
  }, icon('plus', 15), t('tag.add'));

  const body = el('div', {},
    el('div', { class: 'section__title' }, t('tag.selected')),
    list,
    el('hr', { class: 'divider' }),
    el('div', { class: 'section__title' }, t('tag.new')),
    el('label', { class: 'field' }, el('span', { class: 'field__label' }, t('tag.name')), nameInput),
    el('label', { class: 'field' }, el('span', { class: 'field__label' }, t('tag.category')), catInput),
    addBtn,
  );

  const sheet = openSheet({ title: t('tag.tags'), content: body });
  return sheet;
}

/* --------------------------- metadata form ---------------------------- */

const META_FIELDS = [
  { key: 'title', label: 'field.title', type: 'text', wide: true },
  { key: 'subtitle', label: 'field.subtitle', type: 'text', wide: true },
  { key: 'authorsText', label: 'field.authors', type: 'text', wide: true },
  { key: 'publisher', label: 'field.publisher', type: 'text' },
  { key: 'year', label: 'field.year', type: 'text' },
  { key: 'pages', label: 'field.pages', type: 'text' },
  { key: 'language', label: 'field.language', type: 'text' },
  { key: 'collection', label: 'field.collection', type: 'text' },
  { key: 'dewey', label: 'field.dewey', type: 'text' },
  { key: 'isbn13', label: 'field.isbn', type: 'text' },
];

/**
 * Editable metadata block. Returns { node, read(), set() }.
 * `model` is a plain object mutated in place by the inputs.
 */
export function metadataForm(model) {
  const node = el('div', { class: 'meta-form' });
  const grid = el('div', { class: 'field-grid' });
  const inputs = {};

  META_FIELDS.forEach((f) => {
    const input = el('input', {
      class: 'input', type: 'text', value: model[f.key] ?? '',
      placeholder: f.type === 'text' ? '' : '',
      inputmode: f.key === 'year' || f.key === 'pages' ? 'numeric' : 'text',
      oninput: (e) => { model[f.key] = e.currentTarget.value; },
    });
    inputs[f.key] = input;
    grid.append(el('label', { class: f.wide ? 'field' : 'field' },
      el('span', { class: 'field__label' }, t(f.label)),
      input));
  });

  node.append(grid);

  const read = () => {
    const out = { ...model };
    out.authors = String(model.authorsText || '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
    delete out.authorsText;
    out.year = String(model.year || '').trim();
    out.pages = String(model.pages || '').trim();
    return out;
  };
  const set = (next) => {
    Object.assign(model, next);
    if (Array.isArray(model.authors)) model.authorsText = model.authors.join(' ; ');
    META_FIELDS.forEach((f) => { if (inputs[f.key]) inputs[f.key].value = model[f.key] ?? ''; });
  };

  return { node, read, set };
}

/* --------------------------- book detail sheet -------------------------- */

/** Full detail sheet for a book: metadata, location, tags, actions. */
export function openBookDetail(bookId, { onChanged } = {}) {
  const book = store.findBook(bookId);
  if (!book) return null;

  const loc = store.findLocation(book.locationId);
  const tagNames = (book.tagIds || []).map((id) => store.tagName(id)).filter(Boolean);

  const cover = el('div', { class: 'detail__cover' });
  if (book.coverUrl) {
    cover.append(el('img', {
      src: book.coverUrl, alt: book.title ? `Couverture de ${book.title}` : 'Couverture',
      referrerpolicy: 'no-referrer',
      onerror: (e) => { e.currentTarget.remove(); cover.append(icon('book', 34)); },
    }));
  } else {
    cover.style.display = 'grid';
    cover.style.placeItems = 'center';
    cover.append(icon('book', 34));
  }

  const rows = [
    [t('field.author'), (book.authors || []).join(', ')],
    [t('field.publisher'), book.publisher],
    [t('field.year'), book.year],
    [t('field.pages'), book.pages],
    [t('field.language'), book.language],
    [t('field.collection'), book.collection],
    [t('field.dewey'), book.dewey],
    [t('field.isbn'), book.isbn13 || book.isbn10],
    [t('location.label'), loc ? store.locationLabel(loc) : ''],
    [t('field.subjects'), (book.subjects || []).join(', ')],
  ].filter(([, v]) => v);

  const meta = el('dl', { class: 'meta-grid' });
  rows.forEach(([k, v]) => {
    meta.append(el('dt', {}, k), el('dd', {}, v));
  });

  const head = el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '14px', marginBottom: '14px' } },
    cover,
    el('div', { class: 'grow' },
      el('h3', { style: { fontSize: '1.12rem', lineHeight: '1.25' } }, book.title || '—'),
      book.subtitle ? el('p', { class: 'small muted', style: { margin: '4px 0 0' } }, book.subtitle) : null,
      el('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } },
        starsEl(book.rating || 0, { size: 15, label: `${book.rating || 0}/5` }),
        el('span', { class: `badge badge--${book.source || 'manual'}` }, t(`scan.source.${book.source === 'bnf' ? 'bnf' : book.source === 'google' ? 'google' : 'manual'}`)),
        book.borrowed ? el('span', { class: 'badge badge--warn' }, t('library.borrowed')) : null,
      ),
    ));

  const tagRow = tagNames.length
    ? el('div', { class: 'chips', style: { marginTop: '10px' } }, tagNames.map((n) => el('span', { class: 'chip chip--sm chip--tag' }, icon('tag', 12), n)))
    : null;

  const body = el('div', {},
    head,
    meta,
    tagRow,
    book.description ? el('div', { style: { marginTop: '14px' } },
      el('div', { class: 'section__title' }, t('field.description')),
      el('p', { class: 'small muted' }, book.description)) : null,
    book.notes ? el('div', { style: { marginTop: '12px' } },
      el('div', { class: 'section__title' }, t('field.notes')),
      el('p', { class: 'small' }, book.notes)) : null,
    el('div', { class: 'tiny muted', style: { marginTop: '14px' } },
      `${t('library.addedOn', { date: fmtDate(book.addedAt) })} · ${t('library.updatedOn', { date: fmtDate(book.updatedAt) })}`),
    book.catalogueUrl ? el('a', {
      class: 'btn btn--secondary btn--sm', style: { marginTop: '12px' },
      href: book.catalogueUrl, target: '_blank', rel: 'noopener noreferrer',
    }, icon('external', 15), t('library.catalogue')) : null,
  );

  const editBtn = el('button', { class: 'btn btn--secondary', type: 'button' }, icon('edit', 16), t('library.edit'));
  const delBtn = el('button', { class: 'btn btn--danger', type: 'button' }, icon('trash', 16), t('common.delete'));

  const sheet = openSheet({
    title: t('library.details'),
    content: body,
    actions: [delBtn, editBtn],
  });

  editBtn.addEventListener('click', () => {
    sheet.close();
    openBookEditor({ bookId, onSaved: () => { if (onChanged) onChanged(); } });
  });

  delBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: t('library.delete'),
      message: t('library.deleteConfirm', { title: book.title || '' }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await store.deleteBook(bookId);
    sheet.close();
    toast(t('common.done'), 'success');
    if (onChanged) onChanged();
  });

  return sheet;
}

/* ----------------------------- book editor ----------------------------- */

/** Edit an existing book (metadata + location + tags + rating + notes). */
export function openBookEditor({ bookId, onSaved }) {
  const book = store.findBook(bookId);
  if (!book) return null;

  const model = {
    title: book.title || '',
    subtitle: book.subtitle || '',
    authorsText: (book.authors || []).join(' ; '),
    publisher: book.publisher || '',
    year: book.year || '',
    pages: book.pages || '',
    language: book.language || '',
    collection: book.collection || '',
    dewey: book.dewey || '',
    isbn13: book.isbn13 || book.isbn10 || '',
    description: book.description || '',
  };

  const form = metadataForm(model);
  let locationId = book.locationId || '';
  let tagIds = [...(book.tagIds || [])];
  let rating = book.rating || 0;

  const locWrap = el('div', {});
  const picker = locationPicker(locationId, (id) => { locationId = id; });
  locWrap.append(picker);

  const tagChips = el('div', { class: 'chips' });
  const renderTags = () => {
    tagChips.innerHTML = '';
    tagIds.forEach((id) => {
      const name = store.tagName(id);
      if (!name) return;
      tagChips.append(el('span', { class: 'chip chip--sm chip--tag' }, icon('tag', 12), name,
        el('button', {
          class: 'chip__x', type: 'button', 'aria-label': `Retirer ${name}`,
          onclick: () => { tagIds = tagIds.filter((x) => x !== id); renderTags(); },
        }, '×')));
    });
    if (!tagIds.length) tagChips.append(el('span', { class: 'tiny muted' }, t('tag.none')));
  };
  renderTags();

  const ratingBox = el('div', { class: 'row' },
    starsEl(rating, { size: 26, onPick: (v) => { rating = v; renderRating(); } }),
    el('span', { class: 'tiny muted', id: 'rating-label' }, rating ? `${rating}/5` : t('rating.unrated')),
  );
  const renderRating = () => {
    ratingBox.replaceChild(starsEl(rating, { size: 26, onPick: (v) => { rating = v; renderRating(); } }), ratingBox.firstChild);
    ratingBox.lastChild.textContent = rating ? `${rating}/5` : t('rating.unrated');
  };

  const notesInput = el('textarea', {
    class: 'textarea', placeholder: t('field.notes'),
    oninput: (e) => { model.notes = e.currentTarget.value; },
  });
  notesInput.value = book.notes || '';

  const borrowedInput = el('input', { type: 'checkbox', class: 'switch', 'aria-checked': String(!!book.borrowed) });
  borrowedInput.addEventListener('click', () => borrowedInput.setAttribute('aria-checked', String(borrowedInput.getAttribute('aria-checked') !== 'true')));

  const body = el('div', {},
    form.node,
    el('div', { class: 'section__title', style: { marginTop: '8px' } }, t('location.label')),
    locWrap,
    el('div', { class: 'section__title', style: { marginTop: '14px' } }, t('tag.tags')),
    tagChips,
    el('button', {
      type: 'button', class: 'btn btn--secondary btn--sm', style: { marginTop: '8px' },
      onclick: () => openTagPicker({ selectedIds: tagIds, onChange: (ids) => { tagIds = ids; renderTags(); } }),
    }, icon('plus', 15), t('tag.add')),
    el('div', { class: 'section__title', style: { marginTop: '14px' } }, t('rating.title')),
    ratingBox,
    el('div', { class: 'section__title', style: { marginTop: '14px' } }, t('field.notes')),
    notesInput,
    el('div', { class: 'setting-row', style: { marginTop: '10px' } },
      el('div', { class: 'setting-row__main' }, el('div', { class: 'setting-row__title' }, t('library.borrowed'))),
      borrowedInput),
  );

  const save = el('button', {
    class: 'btn btn--primary', type: 'button',
    onclick: async () => {
      const values = form.read();
      await store.updateBook(bookId, {
        ...values,
        notes: model.notes || '',
        locationId,
        tagIds,
        rating,
        borrowed: borrowedInput.getAttribute('aria-checked') === 'true',
      });
      sheet.close();
      toast(t('common.done'), 'success');
      if (onSaved) onSaved();
    },
  }, icon('save', 16), t('common.save'));

  const sheet = openSheet({ title: t('library.edit'), content: body, actions: [save], size: 'md' });
  return sheet;
}
