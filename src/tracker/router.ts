/**
 * Hash router for the tracker console. Routes are deep-linkable on a static
 * host (no server routing):
 *
 *   #/                     overview
 *   #/stations?cc=DE&v=bad unified station table, filters in the params
 *   #/station/<id>         per-station detail
 *   #/sources              upstream source inventory
 *   #/process              pipeline documentation
 *
 * Pre-rebuild hashes (#health, #matrix, #sources) redirect to their new homes
 * so old bookmarks keep working.
 */

export interface Route {
  view: 'overview' | 'stations' | 'station' | 'sources' | 'process';
  /** Station id for the detail view. */
  id?: string;
  params: URLSearchParams;
}

const LEGACY: Record<string, string> = {
  '#health': '#/stations',
  '#matrix': '#/stations?set=logo',
  '#sources': '#/sources',
};

export function parseRoute(hash: string): Route {
  const legacy = LEGACY[hash];
  if (legacy) {
    history.replaceState(null, '', legacy);
    hash = legacy;
  }
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'station' && segments[1]) {
    return { view: 'station', id: decodeURIComponent(segments[1]), params };
  }
  if (segments[0] === 'stations') return { view: 'stations', params };
  if (segments[0] === 'sources') return { view: 'sources', params };
  if (segments[0] === 'process') return { view: 'process', params };
  return { view: 'overview', params };
}

export function currentRoute(): Route {
  return parseRoute(window.location.hash);
}

export function navigate(path: string): void {
  if (window.location.hash === path) return;
  window.location.hash = path;
}

export function stationHref(id: string): string {
  return `#/station/${encodeURIComponent(id)}`;
}

export function stationsHref(params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return search ? `#/stations?${search}` : '#/stations';
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
