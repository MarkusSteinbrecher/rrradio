import { STATS_WORKER_BASE } from './config';
import { truncateErrorMessage } from './errors';
import type { Station } from './types';

declare const __BUILD_VERSION__: string;
const BUILD: string =
  typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';

export async function reportBrokenStation(
  station: Station,
  reason?: string,
): Promise<void> {
  const body = {
    stationId: station.id,
    stationName: station.name,
    streamUrl: station.streamUrl,
    platform: 'web',
    appVersion: BUILD,
    reason: truncateErrorMessage(reason ?? ''),
    source: 'manual',
  };

  const res = await fetch(`${STATS_WORKER_BASE}/api/public/report-broken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`report failed: ${res.status}`);
  }
}
