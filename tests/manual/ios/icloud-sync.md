# iCloud sync — two-device flow

> Verify that favorites, custom stations, theme, language, and default sleep timer sync across two devices via the user's private iCloud database. **Two real devices required, both signed into the same Apple ID with iCloud Drive on.** ~15 minutes; iCloud propagation is intrinsically slow.

## Preconditions

- [ ] Build under test: __________ (same build on both devices)
- [ ] Test environment: **two real devices** signed into the same Apple ID, both with iCloud Drive on, both with rrradio's "Use iCloud" toggled on
- [ ] Both devices on Wi-Fi, recently signed-in, awake (iCloud sync slows when devices are sleeping)
- [ ] Each device has the catalog loaded (run [`first-run.md`](first-run.md) on each)
- [ ] Optional but useful: a fresh state on at least one device — favorites cleared, custom stations cleared, so you start "clean → synced"

## Steps

### Initial sync — favorites

1. On **Device A**, favorite **3 different stations** (e.g. WDR 5, FM4, Radio Swiss Pop) — expected: heart icons fill; Library shows them.
2. Wait 60 seconds. Open **Device B** — expected: the same 3 favorites appear in Library on Device B without manual refresh. (Pull-to-refresh on Device B if you want to force the check.)
3. On **Device B**, remove one favorite — expected: it disappears on Device B immediately.
4. Wait 60 seconds. Check **Device A** — expected: the removed favorite is gone there too.

### Custom stations

5. On **Device A**, add a custom HTTPS station (per [`custom-station.md`](custom-station.md)) — expected: appears in the Custom list locally.
6. Wait 60 seconds. Check **Device B** — expected: the custom station appears there too; tappable, playable.
7. On **Device B**, delete the custom station — expected: gone locally.
8. Wait 60 seconds. Check **Device A** — expected: deletion has propagated.

### Theme / language / default sleep timer

9. On **Device A**, change the accent theme (Orange / Teal / Blue, or whatever the project supports) — expected: UI re-themes.
10. Wait 60 seconds. Check **Device B** — expected: the theme has switched to match. (Theme sync is a documented feature per [`ios/README.md`](../../../ios/README.md).)
11. On **Device A**, change the **default sleep timer** to 30 min — expected: change persists locally.
12. Wait 60 seconds. Check **Device B**'s sleep-timer settings — expected: default is now 30 min.
13. (Optional) On **Device A**, switch the language preference — expected: UI re-localizes; sync to **Device B** within 60 seconds.

### Conflict / divergence

14. Disable iCloud (turn off the "Use iCloud" toggle in rrradio) on **Device A**. Make a divergent local change (favorite or remove a station).
15. Re-enable iCloud on **Device A** — expected: the merge/conflict policy in [`CloudSyncSnapshot.swift`](../../../ios/rrradio/CloudSync/CloudSyncSnapshot.swift) takes effect. Document the resolved state on both devices. Neither device should crash, neither should lose data unexpectedly (no silent overwrites).

### Recovery — iCloud unavailable

16. On **Device A**, sign out of iCloud (Settings → Apple ID → Sign Out) — expected: rrradio still launches and works locally; favorites/custom stations remain in the local UserDefaults; banner or status indicator notes iCloud is unavailable.
17. Sign back into iCloud — expected: app re-syncs within 60–120 seconds; local state merges with cloud state per the documented policy.

## Acceptance

- [ ] Favorites added on one device appear on the other within ~60 seconds
- [ ] Favorites removed on one device disappear on the other within ~60 seconds
- [ ] Custom stations sync (add and remove) within ~60 seconds
- [ ] Theme syncs across devices
- [ ] Default sleep timer syncs across devices
- [ ] Disabling and re-enabling iCloud on one device handles conflicts without data loss or crash
- [ ] Signing out of iCloud entirely keeps the app local-only and functional
- [ ] No spinner-stuck-forever, no crash, no silent data loss across any of the above

## Notes for the tester

- iCloud propagation is **not deterministic** — 30 to 120 seconds is the expected range, occasionally longer. Don't declare failure under 2 minutes.
- The merge/conflict logic is exercised by `CloudSyncMergeTests.swift`; manual UAT verifies the integration. If you find an unexpected conflict resolution, capture both devices' state in the bug report (favorites list before/after on each side).
- Recents are intentionally **not** synced (recents are device-local). If you see them syncing, that's a bug.
- If iCloud appears completely silent (no sync ever), check: both devices are on the same Apple ID, "Use iCloud" toggle is on in rrradio's settings on both, iCloud Drive is on globally on both, and Settings → Apple ID → iCloud → rrradio is enabled.
- TestFlight builds and App Store builds use **the same iCloud container**; mixing them between devices is fine. Local Xcode builds (development) use the **development container** and won't sync to TestFlight/AppStore installs.
