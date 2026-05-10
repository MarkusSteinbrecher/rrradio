# Wake To Radio On iOS

rrradio has three wake-to-radio paths on iPhone:

- In-app wake alarm: rrradio keeps a timer while the app remains alive, and schedules a local notification fallback.
- Keep audio alive until wake: rrradio plays a near-silent local sound to keep its audio session active, then switches to the selected station at wake time.
- Shortcuts Personal Automation: iOS can run a rrradio action on a schedule when it allows app launch.

Use the in-app wake alarm with "Keep audio alive until wake" when you need the best chance of unattended autoplay.

## Why The In-App Alarm Has Limits

iOS can suspend third-party apps when the screen is locked, especially after playback is paused. A suspended app cannot run an in-process timer at the exact wake time, and a local notification cannot auto-start live audio by itself.

That means:

- If rrradio is still alive at the wake time, the in-app alarm can start the station.
- If iOS suspended rrradio, the notification fallback is the reliable signal.
- If the app is closed or force-quit, rrradio cannot relaunch itself and start audio.
- Shortcuts can fail from the lock screen when iOS decides the app would need to unlock before launch.

## Keep Audio Alive Until Wake

The wake sheet includes a "Keep audio alive until wake" option. When enabled, rrradio starts a looped near-silent local sound if no real station is playing. That keeps the background audio session active so iOS is less likely to suspend the app before the wake time.

This is the closest in-app path to reliable autoplay, but it has tradeoffs:

- It uses battery overnight.
- It only works while rrradio remains installed and running.
- It does not survive force-quit.
- iOS may still change behavior in future releases.
- It should be tested on the actual iPhone before relying on it as an alarm.

## Recommended Setup

For unattended wake-to-radio, use the in-app wake alarm and enable "Keep audio alive until wake" in the wake sheet. This keeps rrradio's audio session active with a near-silent local sound until the selected station starts.

If you prefer a Shortcuts automation:

1. Open the Shortcuts app.
2. Go to Automation.
3. Create a new Personal Automation.
4. Choose Time of Day.
5. Pick the wake time and repeat schedule.
6. Add an action from rrradio.
7. Choose Play Station or Play Last Station.
8. Pick the station if you chose Play Station.
9. Enable Run Without Asking when iOS offers it.
10. Save the automation.

For a simple morning setup, choose Play Last Station and play the desired station once in rrradio before going to sleep. If iOS reports that it could not start the app because the phone could not unlock, use the in-app wake alarm with "Keep audio alive until wake" instead.

## Available rrradio Actions

### Play Station

Starts a specific station. The station picker is populated from your local rrradio data: favorites, recents, custom stations, and the cached catalog.

### Play Last Station

Starts the most recently played station. This is useful for a stable "morning resume" automation.

## Practical Notes

- Leave the station playable in rrradio before testing the automation.
- The first run may ask for notification or Shortcuts permissions.
- The action opens rrradio because iOS generally requires the app to be foregrounded before live audio can start.
- "Run Without Asking" is controlled by iOS per automation. rrradio cannot enable it programmatically.
- Keep the local notification fallback enabled for the in-app wake alarm. It is the only OS-level cue when the app was suspended.

## Testing

To verify keep-alive wake:

1. Set the in-app wake alarm for a few minutes in the future.
2. In rrradio, play a station and open the wake sheet.
3. Enable "Keep audio alive until wake" and set the wake.
4. Pause playback if you want rrradio to use the near-silent local sound.
5. Lock the iPhone.
6. Wait without touching the screen.
7. Confirm rrradio switches to the selected wake station.

For the real morning case, test once overnight with the phone locked and the in-app wake alarm set to your actual wake time.
