import { describe, expect, it, vi } from 'vitest';
import { CHECK_INTERVAL_MS, createBuildChecker, type BuildCheckDeps } from './buildCheck';

function setup(over: Partial<BuildCheckDeps> = {}) {
  let t = 1_000_000;
  const deps = {
    current: 'abc1234@2026-10-01',
    fetchVersion: vi.fn(async () => 'def5678@2026-10-16' as string | null),
    isBusy: vi.fn(() => false),
    reload: vi.fn(),
    now: () => t,
    ...over,
  };
  return { deps, check: createBuildChecker(deps), advance: (ms: number) => (t += ms) };
}

describe('createBuildChecker', () => {
  it('reloads when a newer build is live and the player is idle', async () => {
    const { deps, check } = setup();
    await check();
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the live build matches', async () => {
    const { deps, check } = setup({ fetchVersion: vi.fn(async () => 'abc1234@2026-10-01') });
    await check();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('treats an unknown live version as no update', async () => {
    const { deps, check } = setup({ fetchVersion: vi.fn(async () => null) });
    await check();
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('defers the reload while playing, then applies it without refetching', async () => {
    let busy = true;
    const { deps, check } = setup({ isBusy: () => busy });
    await check();
    expect(deps.reload).not.toHaveBeenCalled();
    busy = false;
    await check();
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(deps.fetchVersion).toHaveBeenCalledTimes(1);
  });

  it('throttles server checks', async () => {
    const { deps, check, advance } = setup({ fetchVersion: vi.fn(async () => 'abc1234@2026-10-01') });
    await check();
    await check();
    expect(deps.fetchVersion).toHaveBeenCalledTimes(1);
    advance(CHECK_INTERVAL_MS);
    await check();
    expect(deps.fetchVersion).toHaveBeenCalledTimes(2);
  });

  it('never checks on a dev build', async () => {
    const { deps, check } = setup({ current: 'dev' });
    await check();
    expect(deps.fetchVersion).not.toHaveBeenCalled();
  });
});
