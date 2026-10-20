/**
 * Library view — search, filter, sort and open a book.
 * Search covers title, subtitle, authors, ISBN, publisher, tags, location
 * and notes (diacritic-insensitive).
 */
import { t } from '../strings.js';
import { el, icon, starsEl, toast, debounce, norm, num } from '../util.js';
import * as store from '../store.js';
import { bookRow } from './scan.js';
import { openBookDetail } from './shared.js';

const filters = {
  query: '',
  room: '',
  tag: '',
  source: '',
  rating: 0,
  unassigned: false,
  sort: 'dateAdded',
};

export function renderLibrary(root, { onChanged }) {
  const view = el('div', { class: 'view view--library' });
  root.append(view);
  const listHost = el('div', { class: 'list' });
  const countHost = el('div', { class: 'small muted' });
  const filterHost = el('div', { class: 'pill-row', style: { marginBottom: '10px' } });

  /* ------------------------------ search ----------------------------- */

  const searchInput = el('input', {
    class: 'input', type: 'search', autocomplete: 'off',
    placeholder: `${t('common.search')} — ${t('field.title')}, ${t('field.author')}, ${t('tag.tags')}…`,
    value: filters.query,
    oninput: debounce(() => { filters.query = searchInput.value; refresh(); }, 180),
  });

  const clearBtn = el('button', {
    class: 'searchbar__clear', type: 'button', 'aria-label': t('common.clearFilters'),
    onclick: () => { searchInput.value = ''; filters.query = ''; refresh(); },
  }, icon('x', 16));

  const sortSelect = el('select', {
    class: 'select', style: { width: 'auto', minWidth: '160px' },
    onchange: (e) => { filters.sort = e.currentTarget.value; refresh(); },
  },
    el('option', { value: 'dateAdded' }, t('library.sort.dateAdded')),
    el('option', { value: 'title' }, t('library.sort.title')),
    el('option', { value: 'author' }, t('library.sort.author')),
    el('option', { value: 'year' }, t('library.sort.year')),
    el('option', { value: 'rating' }, t('library.sort.rating')),
  );
  sortSelect.value = filters.sort;

  const toolbar = el('div', { class: 'row', style: { gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
    sortSelect,
    el('button', {
      class: 'btn btn--secondary btn--sm', type: 'button',
      onclick: () => { resetFilters(); refresh(); },
    }, icon('filter', 15), t('common.clearFilters')),
  );

  /* ------------------------------ filters ---------------------------- */

  function resetFilters() {
    filters.query = '';
    filters.room = '';
    filters.tag = '';
    filters.source = '';
    filters.rating = 0;
    filters.unassigned = false;
    searchInput.value = '';
    sortSelect.value = filters.sort;
  }

  function renderFilters() {
    filterHost.innerHTML = '';

    const rooms = [...new Set(store.state.locations.map((l) => l.room).filter(Boolean))];
    const tags = [...store.state.tags].sort((a, b) => a.name.localeCompare(b.name));

    const addChip = (label, active, onClick) => {
      filterHost.append(el('button', {
        type: 'button', class: 'chip chip--sm', 'aria-pressed': String(active), onclick: onClick,
      }, label));
    };

    addChip(t('library.filter.room'), !!filters.room, () => {
      // cycle through rooms
      const list = ['', ...rooms];
      const idx = list.indexOf(filters.room);
      filters.room = list[(idx + 1) % list.length];
      refresh();
    });
    if (filters.room) filterHost.lastChild.textContent = `${t('library.filter.room')}: ${filters.room}`;

    addChip(t('library.filter.tag'), !!filters.tag, () => {
      const list = ['', ...tags.map((x) => x.id)];
      const idx = list.indexOf(filters.tag);
      filters.tag = list[(idx + 1) % list.length];
      refresh();
    });
    if (filters.tag) filterHost.lastChild.textContent = `${t('library.filter.tag')}: ${store.tagName(filters.tag)}`;

    addChip(t('library.filter.source'), !!filters.source, () => {
      const list = ['', 'bnf', 'google', 'manual'];
      const idx = list.indexOf(filters.source);
      filters.source = list[(idx + 1) % list.length];
      refresh();
    });
    if (filters.source) filterHost.lastChild.textContent = `${t('library.filter.source')}: ${t(`scan.source.${filters.source}`)}`;

    addChip(t('library.filter.rating'), filters.rating > 0, () => {
      filters.rating = filters.rating >= 5 ? 0 : filters.rating + 1;
      refresh();
    });
    if (filters.rating) filterHost.lastChild.textContent = `${t('library.filter.rating')}: ${'★'.repeat(filters.rating)}`;

    addChip(t('library.filter.unassigned'), filters.unassigned, () => {
      filters.unassigned = !filters.unassigned;
      refresh();
    });
  }

  /* ------------------------------ filtering --------------------------- */

  function matchBook(book, q) {
    if (!q) return true;
    const loc = store.findLocation(book.locationId);
    const tagNames = (book.tagIds || []).map((id) => store.tagName(id)).join(' ');
    const haystack = norm([
      book.title, book.subtitle, (book.authors || []).join(' '), book.publisher,
      book.isbn13, book.isbn10, book.collection, book.dewey, (book.subjects || []).join(' '),
      book.notes, book.year, tagNames, loc ? store.locationLabel(loc) : '',
    ].filter(Boolean).join(' '));
    return haystack.includes(q);
  }

  function filtered() {
    const q = norm(filters.query.trim());
    let list = store.state.books.filter((b) => {
      if (!matchBook(b, q)) return false;
      if (filters.room) {
        const loc = store.findLocation(b.locationId);
        if (!loc || loc.room !== filters.room) return false;
      }
      if (filters.tag && !(b.tagIds || []).includes(filters.tag)) return false;
      if (filters.source && (b.source || 'manual') !== filters.source) return false;
      if (filters.rating && (b.rating || 0) < filters.rating) return false;
      if (filters.unassigned && b.locationId) return false;
      return true;
    });

    const sorters = {
      dateAdded: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'fr'),
      author: (a, b) => ((a.authors || [])[0] || '').localeCompare((b.authors || [])[0] || '', 'fr'),
      year: (a, b) => String(b.year || '').localeCompare(String(a.year || '')),
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (a.title || '').localeCompare(b.title || '', 'fr'),
    };
    list.sort(sorters[filters.sort] || sorters.dateAdded);
    return list;
  }

  /* ------------------------------- paint ----------------------------- */

  function refresh() {
    renderFilters();
    const list = filtered();
    countHost.textContent = t('library.count', { n: num(list.length) });
    listHost.innerHTML = '';
    if (!list.length) {
      listHost.append(el('div', { class: 'empty' },
        el('div', { class: 'empty__icon' }, icon('search', 24)),
        el('h3', {}, store.state.books.length ? t('common.noResults') : t('library.empty')),
        el('p', { class: 'small' }, store.state.books.length ? '' : t('library.emptyHint')),
      ));
      return;
    }
    list.forEach((b) => listHost.append(bookRow(b, onChanged)));
  }

  view.append(
    el('div', { class: 'section' },
      el('div', { class: 'searchbar' },
        icon('search', 18),
        searchInput,
        clearBtn),
    ),
    filterHost,
    el('div', { class: 'row row--between', style: { marginBottom: '10px' } }, countHost),
    toolbar,
    listHost,
  );

  refresh();
  return () => {};
}
