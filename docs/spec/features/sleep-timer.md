# Sleep Timer Specification

The sleep timer pauses playback after a selected delay.

## Shared Behavior

- Timer choices are off, 15, 30, 60, and 90 minutes.
- The current timer state is visible near playback controls.
- Changing the timer replaces the previous timer.
- Turning the timer off cancels the pending pause.
- When the timer fires, playback pauses.
- Firing the sleep timer must not destroy the active station context.
- If wake-to-radio is armed, sleep behavior must preserve any platform-specific
  wake keep-alive contract.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| Timer cycle | Supported. | Reference. | Supported. |
| Visible remaining time | Supported where UI exposes it. | Supported. | Partial. |
| Background firing | Browser/OS dependent. | Supported while app/session remains eligible. | Planned through service/alarm design. |
| Wake interaction | Silent-bed behavior. | Keep-alive aware. | To be designed with Android wake flow. |

## Android First-Port Requirement

Android includes the sleep timer cycle. Alignment work should verify background
behavior with the app backgrounded and the media notification active.
