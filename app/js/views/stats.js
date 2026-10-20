/**
 * Statistics view — KPIs plus SVG charts (room distribution, Pareto per tag,
 * rating breakdown, publication years, languages, sources).
 */
import { t } from '../strings.js';
import { el, icon, num } from '../util.js';
import * as store from '../store.js';
import { barChart, hBarChart, paretoChart, donutChart, legendList, palette } from '../../../shared/charts.js';
import { computeStats } from '../stats.js';

/** Aggregate the library into a plain object (also used for the XLSX export). */
export { computeStats };

export function renderStats(root) {
  const view = el('div', { class: 'view view--stats' });
  root.append(view);
  const host = el('div', {});
  view.append(host);

  function paint() {
    const s = computeStats();
    host.innerHTML = '';

    /* ------------------------------ KPIs ----------------------------- */
    const kpis = el('div', { class: 'kpi-grid', style: { marginBottom: '16px' } },
      kpi(s.total, t('stats.totalBooks')),
      kpi(s.rooms, t('stats.rooms')),
      kpi(s.tags, t('stats.tags')),
      kpi(s.avgRating ? s.avgRating.toFixed(1) : '—', t('stats.avgRating')),
      kpi(s.unassigned, t('stats.unassigned')),
      kpi(s.withoutCover, t('stats.noCover')),
    );
    host.append(kpis);

    if (!s.total) {
      host.append(el('div', { class: 'empty' },
        el('div', { class: 'empty__icon' }, icon('chart', 24)),
        el('h3', {}, t('stats.noData')),
      ));
      return;
    }

    /* ----------------------------- charts ---------------------------- */
    const roomChart = el('div', { class: 'chart' });
    const tagChart = el('div', { class: 'chart' });
    const ratingChart = el('div', { class: 'chart' });
    const ratingLegend = el('div', { class: 'legend' });
    const yearChart = el('div', { class: 'chart' });
    const langChart = el('div', { class: 'chart' });
    const sourceChart = el('div', { class: 'chart' });
    const sourceLegend = el('div', { class: 'legend' });
    const shelfChart = el('div', { class: 'chart' });

    const cards = el('div', { class: 'two-col' },
      chartCard(t('stats.byRoom'), roomChart, `${s.byRoom.length} · ${t('stats.rooms')}`),
      chartCard(t('stats.byTag'), tagChart, t('stats.top10')),
      chartCard(t('stats.byRating'), el('div', {}, ratingChart, ratingLegend)),
      chartCard(t('stats.byYear'), yearChart),
      chartCard(t('stats.byLanguage'), langChart),
      chartCard(t('stats.bySource'), el('div', {}, sourceChart, sourceLegend)),
      chartCard(t('stats.byShelf'), shelfChart),
    );
    host.append(cards);

    // Render after insertion so the containers have a measured width.
    requestAnimationFrame(() => {
      const p = palette();
      barChart(roomChart, s.byRoom.slice(0, 10).map((d, i) => ({ ...d, color: i === 0 ? p.primary : p.series[i % p.series.length] })), {
        ariaLabel: t('stats.byRoom'),
      });
      paretoChart(tagChart, s.byTag.slice(0, 10).map((d, i) => ({ label: d.label, value: d.value, color: p.primary })), {
        ariaLabel: t('stats.byTag'),
        emptyText: t('stats.noTags'),
      });
      donutChart(ratingChart, s.byRating.map((d, i) => ({ ...d, color: p.series[i % p.series.length] })), {
        ariaLabel: t('stats.byRating'),
        centerLabel: String(s.avgRating ? s.avgRating.toFixed(1) : '—'),
        centerSub: t('stats.avgRating'),
      });
      legendList(ratingLegend, s.byRating.map((d, i) => ({ ...d, color: p.series[i % p.series.length] })));
      barChart(yearChart, s.byYear.slice(-24).map((d, i) => ({ ...d, color: p.accent })), { ariaLabel: t('stats.byYear'), height: 170 });
      hBarChart(langChart, s.byLanguage.slice(0, 8).map((d, i) => ({ ...d, color: p.series[(i + 1) % p.series.length] })), { ariaLabel: t('stats.byLanguage') });
      donutChart(sourceChart, s.bySource.map((d, i) => ({ ...d, color: p.series[i % p.series.length] })), {
        ariaLabel: t('stats.bySource'),
        centerLabel: String(s.total),
        centerSub: t('stats.totalBooks'),
      });
      legendList(sourceLegend, s.bySource.map((d, i) => ({ ...d, color: p.series[i % p.series.length] })));
      hBarChart(shelfChart, s.byShelf.slice(0, 10).map((d, i) => ({ ...d, color: p.series[(i + 2) % p.series.length] })), { ariaLabel: t('stats.byShelf') });
    });
  }

  function chartCard(title, body, meta) {
    return el('div', { class: 'card card--pad' },
      el('div', { class: 'row row--between', style: { marginBottom: '10px' } },
        el('h3', { style: { fontSize: '.95rem' } }, title),
        meta ? el('span', { class: 'tiny muted' }, meta) : null),
      body,
    );
  }

  function kpi(value, label) {
    return el('div', { class: 'kpi' },
      el('div', { class: 'kpi__value' }, typeof value === 'number' ? num(value) : value),
      el('div', { class: 'kpi__label' }, label));
  }

  paint();
  return () => {};
}
