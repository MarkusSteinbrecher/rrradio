# Audio interruption — phone calls, alarms, other apps

> Verify that an interruption (phone call, alarm, another audio app starting) pauses rrradio cleanly and that playback recovers (or stays paused) per AVAudioSession behaviour. **Real device required.** ~8 minutes; you'll need a second phone or a known-callable contact.

## Preconditions

- [ ] Build under test: __________
- [ ] Test environment: **real device**
- [ ] A second phone or a contact who will pick up a test call (or use Apple's automated voicemail — call your own number from the same device's voicemail menu)
- [ ] An alarm set for ~3 minutes from test start (use the Clock app)
- [ ] Another audio app installed (Apple Music, Spotify, YouTube — any will do)

## Steps

### Phone call interruption

1. Start playing a station — expected: audio audible.
2. Have someone call you (or initiate a call from a second device) — expected: rrradio audio **pauses immediately** when the call rings; ringtone plays; lock-screen / Now-Playing card shows paused state.
3. Answer the call, talk for 5 seconds, hang up — expected: rrradio either **resumes automatically** (default AVAudioSession behaviour) **or stays paused** (project may opt out of auto-resume — note current behaviour). Either is correct; document which.
4. If it stayed paused, manually press Play — expected: audio resumes within 2 seconds.

### Alarm interruption

5. Start playback again — expected: audible.
6. Wait for the pre-set alarm to fire — expected: rrradio audio ducks or pauses; alarm sound plays.
7. Dismiss the alarm — expected: rrradio audio recovers per the same auto-resume behaviour as the phone-call case (consistent with step 3).

### Other audio app interruption

8. Start rrradio playback — expected: audible.
9. Open another audio app (Apple Music, Spotify) and play a track — expected: rrradio **pauses**; the other app plays.
10. Pause the other app and return to rrradio — expected: rrradio either auto-resumes or stays paused (consistent with steps 3 / 7); manual Play resumes within 2 seconds.

### Siri interruption (if Siri is configured)

11. Start playback; trigger Siri ("Hey Siri" or side-button hold) — expected: rrradio ducks or pauses while Siri listens; resumes (or stays paused) per consistency.

### Recovery after a long interruption

12. Start playback; place a long phone call (3+ minutes); end the call — expected: stream re-establishes within 5 seconds without manual intervention (assuming auto-resume); no infinite buffering spinner.

## Acceptance

- [ ] Phone call pauses rrradio cleanly and consistently
- [ ] Alarm pauses or ducks rrradio
- [ ] Another audio app pausing rrradio is the expected interaction
- [ ] Recovery is **consistent** across all interruption sources (auto-resume always, or paused always — not mixed)
- [ ] No infinite buffering spinner after recovery
- [ ] Lock-screen card reflects state through every transition

## Notes for the tester

- Auto-resume vs stay-paused is an AVAudioSession policy choice. Either is OK; the bug is *inconsistency* across sources.
- If rrradio fails to pause on a phone call, the audio session is probably not configured as `.playback` with the right mode — that's a wiring bug.
- "Ducking" (rrradio plays quieter under another sound) vs "pausing" (rrradio stops entirely) is also a policy choice. Document which behaviour ships.
- Long-call recovery (>1 minute) sometimes fails because the underlying TCP connection drops. The fix is reconnect-on-resume; if it spins forever, that's a high-severity bug.
