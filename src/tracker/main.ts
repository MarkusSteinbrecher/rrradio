/**
 * Tracker console boot: sidebar nav + hash router + view dispatch.
 * Views render into #view-root; each owns its container completely.
 */

import { loadHealth, loadRows } from './data';
import { currentRoute, onRouteChange } from './router';
import type { Route } from './router';
import { ageLabel, el, fmtInt } from './ui';
import { renderOverview } from './view-overview';
import { renderProcess } from './view-process';
import { renderSources } from './view-sources';
import { renderStationDetail } from './view-station-detail';
import { renderStations } from './view-stations';

function must(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`tracker: shell markup missing #${id}`);
  return node;
}
const viewRoot = must('view-root');
const pageTitle = must('page-title');
const topbarMeta = must('topbar-meta');

const TITLES: Record<Route['view'], string> = {
  overview: 'Overview',
  stations: 'Stations',
  station: 'Station',
  sources: 'Sources',
  process: 'Process',
};

/** Sidebar highlight: the detail view belongs to Stations. */
function navKey(view: Route['view']): string {
  return view === 'station' ? 'stations' : view;
}

let renderSeq = 0;

async function dispatch(route: Route): Promise<void> {
  const seq = ++renderSeq;
  for (const item of document.querySelectorAll<HTMLElement>('[data-nav]')) {
    item.classList.toggle('active', item.dataset.nav === navKey(route.view));
  }
  pageTitle.textContent = TITLES[route.view];

  const root = el('div', { class: 'content' });
  // Swap in a fresh container only if no newer navigation superseded us.
  const commit = () => {
    if (seq === renderSeq) viewRoot.replaceChildren(root);
  };
  commit();
  try {
    if (route.view === 'overview') await renderOverview(root);
    else if (route.view === 'stations') await renderStations(root, route.params);
    else if (route.view === 'station') await renderStationDetail(root, route.id ?? '');
    else if (route.view === 'sources') await renderSources(root);
    else await renderProcess(root);
  } catch (err) {
    if (seq === renderSeq) {
      root.replaceChildren(
        el('div', { class: 'empty-state' }, `Failed to render: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}

async function updateTopbarMeta(): Promise<void> {
  try {
    const [rows, health] = await Promise.all([loadRows(), loadHealth()]);
    const newest = Object.values(health?.runs ?? {})
      .map((r) => r.lastRun)
      .sort()
      .pop();
    topbarMeta.textContent = `${fmtInt(rows.length)} stations · health ${newest ? ageLabel(newest) : 'unavailable'}`;
  } catch {
    topbarMeta.textContent = 'catalog unavailable';
  }
}

onRouteChange((route) => void dispatch(route));
void dispatch(currentRoute());
void updateTopbarMeta();
