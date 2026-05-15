# Wake To Radio Specification

Wake to radio is best-effort alarm-style playback. It is constrained by each
operating system's rules for autoplay, background execution, exact alarms, and
app relaunch.

## Shared Product Behavior

- The user chooses a station and a time.
- Only one active wake intent is supported unless a future spec changes that.
- The wake target should be visible while armed.
- The user can disarm the wake.
- If the platform cannot auto-start audio, it must still provide the most
  reliable user-visible cue it can.
- Wake telemetry/diagnostics must not include private station URLs.

## Platform Matrix

| Behavior | Web | iOS | Android |
|---|---|---|---|
| In-app timer | Supported while tab/session remains alive. | Supported while app remains alive. | Planned while process/service remains alive. |
| Keep audio alive | Silent-bed audio workaround. | Near-silent local audio keep-alive. | TBD, likely foreground service if allowed. |
| Local notification fallback | Browser support dependent. | Supported. | Planned. |
| Shortcuts/automation | Not applicable. | Supported through App Intents/Shortcuts. | Not applicable. |
| Exact alarm | Not available. | Not available to third-party app in this sense. | Open decision; may require permission. |
| Survives force quit | No. | No. | No reliable guarantee. |

## Web

The web wake flow is browser-limited. It can work while the page and audio
session remain eligible, but it must not promise alarm-clock reliability.

## iOS

iOS is the current reference behavior:

- In-app wake alarm.
- Near-silent keep-alive option.
- Local notification fallback.
- App Intents/Shortcuts actions for Play Station and Play Last Station.

See [Wake to radio on iOS](../../wake-to-radio.md) for setup and limits.

## Android

Android wake-to-radio needs a separate implementation decision before coding.
The spec should decide:

- Whether exact alarms are acceptable.
- Whether requesting exact-alarm permission matches the product.
- Whether a foreground media service is required while armed.
- How to explain battery optimization limits.
- What fallback notification copy says when autoplay cannot happen.

The first Android port may defer wake-to-radio if playback, Favorites, and
custom stations are the launch scope.
