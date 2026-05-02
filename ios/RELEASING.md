# Releasing rrradio iOS to the App Store

End-to-end guide for a solo developer taking the rrradio iOS app from
"works in the simulator" to "live in the App Store". Written for the
v0.1 scaffold; revise as the app gains features.

There's no shortcut path: Apple requires the Developer Program
enrollment, a bundle of metadata + assets, and at least one review
cycle. Realistic timeline from a freshly-tested build to "available
for download" is **5–10 business days** for a first-time submission,
most of which is human review queues — not your effort.

---

## 0 · Pre-flight checklist

Before you touch the App Store side, your build needs to actually be
ready to ship:

- [ ] Tested on at least one real iPhone (simulator playback differs
      enough — especially around the audio session, lock-screen card,
      AirPods controls, and background behaviour — that simulator-only
      testing isn't enough).
- [ ] No crashes during a 30-min listening session (start, lock,
      unlock, switch stations, background, return, AirPods controls).
- [ ] All third-party stream URLs you ship play fine — Apple reviewers
      will spot-check several.
- [ ] App icon designed (1024×1024 PNG, no alpha channel, no rounded
      corners — Apple applies the mask automatically).
- [ ] Privacy posture decided (see §6).
- [ ] App name decided. **Check the App Store** — search for your
      proposed name on the iPhone app. If a popular app already owns
      it, Apple will likely reject. "rrradio" is uncommon, should be
      fine.
- [ ] Mac you'll submit from has Xcode 15.4+ installed (App Store
      submission requires a relatively recent Xcode).

---

## 1 · Apple Developer Program enrollment (one-time, ~$99/year)

**Individual** is the right choice unless you're shipping under a
company name. Individual enrollment uses your personal name on the
App Store listing; Organization enrollment requires a D-U-N-S number
and takes 2–4 weeks to verify.

1. Go to <https://developer.apple.com/programs/enroll/>.
2. Sign in with the Apple ID you want to own this account (use a
   long-lived one, not a throwaway).
3. Pick **Individual / Sole Proprietor**.
4. Enter your legal name, address, phone. Apple uses these on the
   store listing under the "Seller" field.
5. Pay $99 USD (or local equivalent). Auto-renews yearly; cancel from
   the same dashboard.
6. **Wait 24–48 hours** for activation. You'll get an email when the
   account becomes active.

While you wait, you can do everything in §2–§3.

---

## 2 · Bundle identifier + capabilities

The bundle ID is permanent — once submitted, you can't change it for
that app. The current scaffold uses `org.rrradio.ios` (set in
`ios/project.yml` under `PRODUCT_BUNDLE_IDENTIFIER`). Decide before
the first submission whether that's right; suggested alternatives:

- `org.rrradio.ios` — matches the public org-style naming
- `com.<yourname>.rrradio` — personal-namespace style; safe choice
  if you might later transfer the app to an entity

Once enrolled in the Developer Program:

1. Go to <https://developer.apple.com/account/resources/identifiers/>.
2. Click **+ → App IDs → App**.
3. Description: `rrradio iOS`. Bundle ID: explicit, paste your chosen
   bundle ID (case-sensitive, must match what Xcode emits).
4. **Capabilities** — tick:
   - **Background Modes** (the `UIBackgroundModes: [audio]` from the
     Info.plist needs the corresponding entitlement).
   - Nothing else is needed for v0.1. (Push notifications, iCloud,
     Game Center, etc. — none apply yet.)
5. Continue → Register.

---

## 3 · App Store Connect record

App Store Connect is where the actual store listing lives. Separate
site from developer.apple.com.

1. Go to <https://appstoreconnect.apple.com> → **My Apps → +**.
2. **New App** dialog:
   - Platform: **iOS**
   - Name: `rrradio` (or your final choice — this is the
     user-visible app name; can be slightly longer than the home-
     screen label, max 30 chars)
   - Primary Language: **English (U.S.)** unless you're shipping
     localized first
   - Bundle ID: pick the one you registered in §2
   - SKU: anything unique to your account, e.g. `rrradio-ios`
   - User Access: **Full Access**

You now have an empty app record. Several sections need filling out
before submission — Apple won't let you submit until each is at
"Ready to Submit" status.

---

## 4 · Required metadata (App Store Connect → App Information + iOS App)

### Categories
- Primary: **Music**
- Secondary: **News** (rrradio surfaces news/talk stations too)

### Pricing & Availability
- **Free** (no IAP planned)
- Available in: **All countries** (or restrict if a station you ship
  is geo-locked — none of the curated catalog is, so worldwide is
  fine)

### App Privacy
This is the most-changed surface in recent App Store Connect updates.
You must declare every category of data the app collects/uses, plus
whether it's linked to identity and used for tracking. For rrradio:

- **Data Not Collected** is the truthful default for the app code
  itself — it doesn't write user data to a server.
- The web app at rrradio.org does use **GoatCounter** (privacy-
  friendly pageview analytics). If the iOS app calls the same Worker
  that backs `rrradio.org/stations.json`, GoatCounter sees nothing
  about iOS users (the worker doesn't pageview-track iOS callers).
  So "Data Not Collected" still applies if you're careful not to add
  analytics to the iOS app itself.
- **If you later add anonymous analytics**, declare:
  - Data Type: *Diagnostic Data → Crash Data, Performance Data*
  - Linked to identity: **No**
  - Used to track you: **No**

For the third-party stream URLs the app hits (BR, HR, SRG SSR, etc.),
those broadcasters technically receive your user's IP when the audio
stream connects. This is **not data the rrradio app collects** — it's
the same as a web browser hitting any URL. App Store privacy labels
don't require declaring third-party network connections.

### Content Rights
- **Q: Does your app contain, display, or access third-party
  content?** → **Yes**
- Confirm you have the right to use that content. For internet radio,
  the answer is "the broadcasters publish these streams publicly for
  consumption; we're a player." Apple has approved many other radio
  apps with this stance (TuneIn, Radio Garden, RadioPublic, etc.).

### Age Rating
Run through the questionnaire. For a music/news radio app:
- Profanity / Crude humour: **None** (we don't generate or curate any)
- Mature themes: **None**
- Controlled substances: **None**
- All others: **None**

→ Result: **4+**

### Export Compliance
Apple wants to know if the app uses non-trivial encryption.

- HTTPS via standard system APIs (URLSession, AVFoundation) is
  exempt from export classification under U.S. EAR §740.17(b)(1).
- You can mark **"Uses encryption"** = Yes, then **"Exempt"** = Yes.
- Set `ITSAppUsesNonExemptEncryption` = `false` in `Info.plist` so
  TestFlight stops nagging you about it on every build.

### Description, Subtitle, Keywords
Suggested first-pass copy (revise to taste — Apple's character limits
are strict):

- **Subtitle** (30 chars): `Internet radio, simplified.`
- **Promotional Text** (170 chars, can be updated without review):
  `A clean, fast internet-radio app. Hand-curated catalog of public
  broadcasters and community stations from around the world.`
- **Description** (4000 chars): write a longer version covering the
  curation philosophy, supported broadcasters, no-ads / no-tracking
  story, and the GitHub link.
- **Keywords** (100 chars, comma-separated): `radio, internet radio,
  streaming, BR, WDR, NDR, BBC, ORF, SRF, music, news, public radio`
- **Support URL**: <https://github.com/MarkusSteinbrecher/rrradio/issues>
- **Marketing URL**: <https://rrradio.org>

### What's New in This Version
For 1.0: `Initial release.` Future updates: short bullet list of
what changed since the last build users saw.

---

## 5 · Screenshots & app preview

Required screenshot dimensions (App Store Connect rejects out-of-spec
images). For 2026, Apple has consolidated to:

- **iPhone 6.9" display** (iPhone 16 Pro Max etc.): 1320 × 2868 px
- **iPad 13" display**: 2064 × 2752 px (only required if you ship
  iPad too — the project.yml's `TARGETED_DEVICE_FAMILY: "1,2"` does)

You need 2–10 screenshots per device family. Take them on a real
device or via the simulator's `⌘S` save action while running on the
matching simulator size.

Suggested shots (in order):
1. Browse list with several station rows visible
2. Now Playing sheet with a track displayed
3. Search results for a popular brand (`WDR`)
4. (Optional) Map view, once shipped

App previews (15–30 sec videos) are optional and a v1.5+ concern.

---

## 6 · App icon

Required: a single **1024 × 1024 px PNG**, sRGB or P3, **no alpha
channel**, **no rounded corners**, **no transparency**. Apple applies
the mask + corner radius automatically.

Drop the master PNG into
`ios/rrradio/Resources/Assets.xcassets/AppIcon.appiconset/` and update
`Contents.json` to reference it. Xcode 15+ supports a "single-size"
app icon — one 1024×1024 image generates every required smaller size
automatically. The current scaffold's `Contents.json` already follows
that pattern; just drop a `icon-1024.png` in alongside it and add a
`"filename": "icon-1024.png"` entry.

---

## 7 · Build & archive in Xcode

This is the moment Xcode hands a build to App Store Connect.

1. In Xcode, top toolbar → device selector → pick **Any iOS Device
   (arm64)**. (Archives only build for real devices, not simulators.)
2. **Product → Archive** (⇧⌘B then ⌃⌘A actually no — Archive is
   `Product → Archive` from the menu, no default shortcut).
3. Wait. First-time archives can take a few minutes; subsequent ones
   are faster.
4. The **Organizer** window opens automatically when the archive
   completes. Select the new archive → **Distribute App**.
5. Distribution method: **App Store Connect**
6. Destination: **Upload**
7. Signing: **Automatically manage signing**. Xcode will create the
   distribution certificate + provisioning profile if they don't
   exist; first time you'll be prompted to log in to your Developer
   account.
8. Review → **Upload**.

The upload typically takes 5–15 minutes, then you'll see "Successful"
in Organizer. App Store Connect needs another **15–60 minutes** to
process the binary before it shows up under your app's **TestFlight**
or **Distribution** tab.

---

## 8 · TestFlight (strongly recommended before App Store)

TestFlight is Apple's beta distribution. You should ship to TestFlight
first to catch issues that only show up in real installs (signing,
provisioning, ATS exceptions, etc.) before they become rejected
App Store submissions.

1. App Store Connect → your app → **TestFlight** tab.
2. Wait for the build you uploaded in §7 to finish processing — it
   appears here, not in the Distribution tab yet.
3. **Test Information** (one-time): tell Apple what testers should
   try. For internet radio: `Search for any station, tap to play,
   confirm it works on lock screen + AirPods. Try at least one of
   these brands: BR, WDR, BBC, ORF, SRF.`
4. **Internal Testing** (you + up to 100 people on your dev team):
   add your Apple ID. No review — installs immediately. **Use this
   for the first install on your own device** to make sure signing
   works end to end before exposing it to anyone else.
5. **External Testing** (up to 10 000 people): requires Apple's
   first-time review (~1–2 days for a TestFlight review, much faster
   than full App Store review). Send the public link to friends to
   collect early feedback.

Iterate at this stage. Every Xcode-archive-and-upload increments the
build number; testers see the latest automatically.

---

## 9 · Submit for App Store review

Once you're happy with a TestFlight build:

1. App Store Connect → your app → **Distribution** tab.
2. **iOS App** → **+ Version** → enter `1.0.0`.
3. Fill the **What's New** field (`Initial release.`).
4. **Build** section → **+ Select a build** → pick the build you
   tested in §8.
5. Confirm Pricing, App Privacy, Age Rating are all green-checkmarked.
6. **Add for Review** → **Submit to App Review**.

Apple review queue varies. Median for first-time submissions in 2026
is **1–3 business days**. You'll get an email when status changes:

- **In Review** → a human is looking at it
- **Rejected** → see §10
- **Approved** → either auto-released (if you ticked that box) or
  held until you click **Release**

---

## 10 · Common rejection reasons for radio / streaming apps

Anticipate and avoid:

| Issue | Why it happens | Fix |
|---|---|---|
| **Stream doesn't play** during review | Reviewer in the U.S. tests on your default first station; if it's a region-locked broadcaster, they hear nothing | Make sure your initial / featured station works worldwide. Default to a globally-reachable one (e.g. SomaFM, BBC World Service). |
| **Crashes on launch** under reviewer's iOS version | They test on the latest public iOS; your code might assume newer APIs available only in beta | Set `IPHONEOS_DEPLOYMENT_TARGET` (iOS 17 in project.yml) and don't use `if #available` guards for unreleased iOS versions. |
| **Spam / Minimal Functionality** (Guideline 4.2) | Apple is picky about apps that "just wrap a website" | rrradio is fine — it's a native player with curation, search, lock-screen integration. The README + description should make this clear if asked. |
| **Privacy policy URL** | Required for any app that touches the network | Even if you collect nothing yourself, you need a URL to a privacy policy page. Easiest: a short page on rrradio.org explaining "the app makes HTTPS requests to broadcaster servers; no analytics on iOS; no data leaves the device". |
| **Background audio without lock-screen card** (Guideline 2.5.4) | If you declared audio background mode but don't publish to MPNowPlayingInfoCenter, Apple sometimes rejects | The scaffold's AudioPlayer.swift already publishes — you're covered. |
| **Third-party content rights** (5.2.2) | Apple sometimes asks for proof you're allowed to play these streams | Reply: "These are public internet radio streams published by their respective broadcasters for consumption. The app is a player; no content is rehosted." Approval is standard. |

If rejected, you get a **Resolution Center** message with the
specific guideline + repro steps. Reply via the same thread; don't
just resubmit. Most rejections clear in one round.

---

## 11 · Post-launch

After **Approved + Released**:

- **Sales & Trends** in App Store Connect tracks downloads.
- **App Analytics** shows engagement (sessions, retention) — opt-in
  by users, so coverage is partial.
- **Crashes** appear in Xcode → **Window → Organizer → Crashes** tab
  for any user who opted in. Symbolicated automatically when you
  uploaded with **Include app symbols** ticked at archive time
  (default is on; leave it on).
- **Reviews & Ratings** — read them; reply where useful. The first
  review tends to set the tone; good cause to ship a polished v1.0.

### Updating the app

Every code change you want users to get goes through:

1. Xcode → bump `MARKETING_VERSION` in `project.yml` (semver).
   `xcodegen` regenerates the `.xcodeproj` with the new value.
2. Xcode → **Product → Archive** → Upload (same flow as §7).
3. App Store Connect → **+ Version** → `1.0.1` etc. → fill **What's
   New** → **Submit to App Review**.

Subsequent reviews are faster (typically <24h) and rarely rejected
for first-launch reasons.

### Catalog updates

The catalog itself doesn't go through the App Store — `Catalog.swift`
fetches `rrradio.org/stations.json` at launch. So when you add a
station to `data/stations.yaml` and push (which redeploys the web
build), iOS users see the new station on next launch within minutes.
**Only ship a new App Store build when iOS-side code changes.**

---

## 12 · Other things that might come up

### Mac Catalyst

The same SwiftUI codebase can run on macOS via Mac Catalyst with a
single checkbox in the target's General tab. Apple will treat it as
a separate distribution surface (separate review, separate metadata,
same bundle ID with `-maccatalyst` suffix). Worth considering once
v1.x is stable on iOS.

### Watch / TV / CarPlay

- **Apple Watch**: out of scope for v1; would need a separate
  WatchKit target.
- **Apple TV (tvOS)**: similar — separate target, mostly UI rework.
- **CarPlay**: would need the `CarPlay Audio` entitlement, which
  Apple gates behind an application form (look up "CarPlay App
  Entitlement Request"). Requires you to be a registered audio app.
  Reasonable v2 goal once the app has traction.

### App Transport Security (ATS)

iOS blocks plain HTTP by default. The current code only hits HTTPS
URLs (catalog, worker, all curated stream URLs are HTTPS). If you
ever need to add an HTTP-only broadcaster stream, route it through
the Cloudflare worker proxy (already HTTPS) instead of adding ATS
exceptions — exception-laden Info.plist files draw extra scrutiny
during review.
