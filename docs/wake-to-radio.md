# Wake To Radio On iOS

rrradio has two wake-to-radio paths on iPhone:

- In-app wake alarm: rrradio keeps a timer while the app remains alive, and schedules a local notification fallback.
- Shortcuts Personal Automation: iOS launches rrradio on a schedule and runs a rrradio action.

Use the Shortcuts path when you need reliable scheduled autoplay.

## Why The In-App Alarm Has Limits

iOS can suspend third-party apps when the screen is locked, especially after playback is paused. A suspended app cannot run an in-process timer at the exact wake time, and a local notification cannot auto-start live audio by itself.

That means:

- If rrradio is still alive at the wake time, the in-app alarm can start the station.
- If iOS suspended rrradio, the notification fallback is the reliable signal.
- If you want unattended autoplay from a locked phone, use Shortcuts Personal Automation.

## Recommended Setup

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

For a simple morning setup, choose Play Last Station and play the desired station once in rrradio before going to sleep.

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

To verify a scheduled wake:

1. Set the automation for a few minutes in the future.
2. Lock the iPhone.
3. Wait without touching the screen.
4. Confirm rrradio opens and playback starts.

For the real morning case, test once overnight with the phone locked and the automation set to your actual wake time.
