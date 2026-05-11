# Favorites and recents

> Favorite a station, reorder, remove. Verify recents dedupe and limit. UserDefaults persistence across launches. Simulator OK. ~5 minutes.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: simulator or real-device
- [ ] Catalog loaded
- [ ] You can identify the **Favorites** view and the **Recents** view in the Library tab

## Steps

1. Open the **Library** tab — expected: Favorites and Recents lists (currently empty if first run).
2. Return to **Stations**, find a station, and tap the favorite control (heart icon, swipe action, or context menu — note current UX) — expected: visual confirmation (filled heart / toast / row indicator); haptic on real device.
3. Repeat for a total of **3 different stations** — expected: each appears in Favorites in the order added (most-recent first or last — note which).
4. Open Library → **Favorites** — expected: all 3 stations appear with the correct names; none duplicated.
5. **Reorder** favorites if the UX supports it (long-press drag, or edit mode) — expected: order persists immediately; visible re-render.
6. **Remove** one favorite — expected: it disappears from the Favorites list immediately; tile in the Stations list reflects un-favorited state.
7. Play one station, then a different station, then a third station — expected: each play adds an entry to **Recents**.
8. Play one of the same stations again — expected: it does **not** create a duplicate Recents entry; it moves to the top (or the most-recent slot, depending on UX).
9. Play more stations until you exceed the Recents limit (test expects ~10 entries — confirm vs. `LibraryTests.swift`) — expected: oldest entries are evicted; list never exceeds the cap.
10. Force-quit the app and relaunch — expected: Favorites and Recents are exactly as they were; nothing lost.
11. Quickly toggle a favorite on/off twice — expected: state is consistent; no flicker, no duplicate.

## Acceptance

- [ ] Favoriting works; the favorite badge persists across navigation and launches
- [ ] Removing a favorite removes it from Library and updates Stations
- [ ] Reordering persists (if reordering UX exists)
- [ ] Recents dedupes — playing the same station twice doesn't double-list it
- [ ] Recents limit is enforced (oldest evicted)
- [ ] All state survives a force-quit and relaunch

## Notes for the tester

- `LibraryTests.swift` covers the persistence + dedupe + limit logic; manual UAT verifies the UI binds correctly.
- The exact Recents cap (10 vs 20 vs other) is in `Library.swift` — read once before testing so you know what to expect.
- iCloud sync of favorites is **not** part of this script — see [`icloud-sync.md`](icloud-sync.md).
