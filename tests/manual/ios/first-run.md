# First run — fresh install

> Fresh install of rrradio iOS. Verify catalog fetch, initial UI, empty library state. Run on a clean device or a freshly-deleted-and-reinstalled app. ~5 minutes.

## Preconditions

- [ ] Build under test: __________ (commit SHA / TF build #)
- [ ] Test environment: real-device or simulator
- [ ] App is **not installed**, OR was installed and then deleted (so UserDefaults + iCloud cache are cleared)
- [ ] Wi-Fi available; signed in to an Apple ID (iCloud not strictly required for this flow)
- [ ] You can reach `https://rrradio.org/stations.json` from this network

## Steps

1. Launch rrradio for the first time — expected: app opens to the **Stations** tab; no flash of empty/error before content.
2. Wait up to ~5 seconds for catalog load — expected: a list of stations appears, scrollable. Country chips and/or tag chips visible above the list.
3. Pull-to-refresh the list — expected: refresh spinner shows briefly, list reloads, no error toast.
4. Tap any station tile — expected: the **Now Playing** sheet (or full screen) opens; play button visible; metadata area shows station name, possibly tags / country.
5. Dismiss the sheet — expected: returns to the list; mini-player **does not** appear (no playback was started yet).
6. Tap the **Library** tab (or its equivalent for favorites/recents) — expected: empty-state copy is friendly; no crash; hint about how to add favorites.
7. Tap the **Add Station** tab (or button) — expected: empty form for adding an HTTPS stream; no crash. Cancel back without entering anything.
8. Force-quit the app and relaunch — expected: catalog is served from disk cache (loads immediately, no spinner); list state preserved.

## Acceptance

- [ ] All steps completed without error
- [ ] Catalog loaded from network on first launch within 5 seconds
- [ ] Catalog loaded from cache on second launch (no visible network spinner)
- [ ] Library and Add-Station screens have empty-state copy, not blank
- [ ] No crash, no error toast, no console error visible if a debugger is attached

## Notes for the tester

- If catalog fetch is slow or fails, check network. The fallback is the published `stations.json` at `rrradio.org/stations.json`; if that file is itself broken, the bug is upstream of the iOS app.
- "Mini-player not appearing" means the persistent bottom bar with play/pause and current station — which only appears once at least one station has been played in this session.
- Empty-state copy is allowed to be terse but should never be a blank screen.
