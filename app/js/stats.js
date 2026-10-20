/**
 * Library aggregation — shared by the statistics view, the XLSX export and
 * the Drive synchronisation.
 */
import { t } from './strings.js';
import * as store from './store.js';

export function computeStats() {
  const books = store.state.books;
  const total = books.length;

  const byRoom = new Map();
  const byTag = new Map();
  const byRating = new Map();
  const byYear = new Map();
  const byLanguage = new Map();
  const bySource = new Map();
  const byShelf = new Map();

  let rated = 0;
  let ratingSum = 0;
  let unassigned = 0;
  let withoutCover = 0;

  books.forEach((b) => {
    const loc = store.findLocation(b.locationId);
    const room = loc?.room || '';
    byRoom.set(room, (byRoom.get(room) || 0) + 1);

    if (!loc) unassigned += 1;
    if (!b.coverUrl) withoutCover += 1;
    if (b.rating) { rated += 1; ratingSum += b.rating; }
    byRating.set(b.rating || 0, (byRating.get(b.rating || 0) || 0) + 1);

    (b.tagIds || []).forEach((id) => byTag.set(id, (byTag.get(id) || 0) + 1));

    if (b.year) byYear.set(b.year, (byYear.get(b.year) || 0) + 1);
    if (b.language) byLanguage.set(b.language, (byLanguage.get(b.language) || 0) + 1);
    bySource.set(b.source || 'manual', (bySource.get(b.source || 'manual') || 0) + 1);

    const shelf = loc?.shelf ? `${loc.room ? loc.room + ' › ' : ''}${loc.shelf}` : '';
    if (shelf) byShelf.set(shelf, (byShelf.get(shelf) || 0) + 1);
  });

  return {
    total,
    rooms: byRoom.size,
    tags: byTag.size,
    avgRating: rated ? ratingSum / rated : 0,
    unassigned,
    withoutCover,
    rated,
    byRoom: [...byRoom.entries()].map(([label, value]) => ({ label: label || t('location.unassigned'), value })).sort((a, b) => b.value - a.value),
    byTag: [...byTag.entries()]
      .map(([id, value]) => ({ id, label: store.tagName(id) || '—', value }))
      .sort((a, b) => b.value - a.value),
    byRating: [...byRating.entries()].map(([label, value]) => ({ label: label ? `${label}★` : t('rating.unrated'), value })).sort((a, b) => Number(a.label) - Number(b.label)),
    byYear: [...byYear.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
    byLanguage: [...byLanguage.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    bySource: [...bySource.entries()].map(([label, value]) => ({ label: t(`scan.source.${label}`) || label, value })).sort((a, b) => b.value - a.value),
    byShelf: [...byShelf.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
  };
}
