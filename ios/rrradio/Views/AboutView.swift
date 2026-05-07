import SwiftUI

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: "About") { dismiss() }
            AboutContentView()
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }
}

struct AboutContentView: View {

    private let githubURL = URL(string: "https://github.com/MarkusSteinbrecher/rrradio/")!
    private let issueURL = URL(string: "https://github.com/MarkusSteinbrecher/rrradio/issues/new")!
    private let emailURL = URL(string: "mailto:redsukramst@gmail.com?subject=rrradio%20feedback")!
    private let privacyURL = URL(string: "https://rrradio.org/privacy.html")!
    private let imprintURL = URL(string: "https://rrradio.org/imprint.html")!
    private let radioBrowserURL = URL(string: "https://www.radio-browser.info/")!
    private let lrclibURL = URL(string: "https://lrclib.net/")!
    private let lyricsOvhURL = URL(string: "https://lyrics.ovh/")!

    var body: some View {
        ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("r r r a d i o . o r g")
                            .font(.system(size: 30, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                        Text("Minimal, ad-free internet radio.")
                            .font(.system(size: 15))
                            .foregroundStyle(RrradioTheme.ink3)
                    }

                    aboutSection("Play") {
                        Text("A simple player for live radio streams from around the world. Designed to feel native on iPhone: background audio, lock-screen controls, bluetooth controls, and a persistent mini player.")
                    }

                    aboutSection("Features") {
                        featureRow("magnifyingglass", "Browse & search", "Curated stations plus thousands more from Radio Browser, filterable by genre, country, news, curated status, or map.")
                        featureRow("lock", "Lock-screen controls", "Play and pause from iOS Now Playing, bluetooth headphones, and system media controls.")
                        featureRow("heart", "Favorites & recents", "Heart stations to save them locally; recently played stations fill in automatically.")
                        featureRow("alarm", "Wake to radio", "Pick a station and time. The app can start playback while it remains alive; iOS shows a notification fallback if needed.")
                        featureRow("alarm", "Sleep timer", "Auto-stop after 30, 60, or 90 minutes.")
                        featureRow("music.note", "Now-playing track", "Current artist, title, cover art, and links to Apple Music, Spotify, and YouTube Music when metadata is available.")
                        featureRow("calendar", "On-air schedule", "Show name and the day's grid for supported major broadcasters.")
                        featureRow("text.quote", "Lyrics", "Lyrics from LRCLIB or Lyrics.ovh when a matching artist and track are available.")
                        featureRow("map", "Map view", "Explore stations with an Apple Maps-based station map.")
                        featureRow("circle.lefthalf.filled", "Themes", "Light, dark, and system color behavior with the rrradio theme palette.")
                        featureRow("plus", "Custom streams", "Paste your own HTTPS stream URL and save it on this device.")
                    }

                    aboutSection("Free, No Ads") {
                        bulletList([
                            "No signup. Nothing to log into.",
                            "No ads, no tracking pixels, no cookie banners.",
                            "No paid features.",
                        ])
                    }

                    aboutSection("Catalog") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Curated stations are hand-picked. Each one shows up to three small stars next to its tags:")
                            Text("* verified stream")
                            Text("** current track")
                            Text("*** program and richer metadata")
                            Text("The wider catalog comes from Radio Browser, a community-maintained directory of internet radio stations around the world. You can also add your own stream; your private list lives on this device only.")
                            inlineLink("Radio Browser", url: radioBrowserURL)
                        }
                    }

                    aboutSection("Program") {
                        Text("For some broadcasters we fetch the on-air schedule alongside the stream. The current show appears on Now Playing; the calendar pane shows what is on now, what is coming up, and what just finished.")
                        Text("Adding a new broadcaster's schedule means wiring a small fetcher in the source. The current set covers much of the English- and German-language curated catalog.")
                    }

                    aboutSection("Lyrics") {
                        Text("When a station broadcasts proper artist and track metadata, rrradio looks up lyrics from LRCLIB first, then Lyrics.ovh as a fallback. The lyrics pane appears only when something matches.")
                        HStack(spacing: 14) {
                            inlineLink("LRCLIB", url: lrclibURL)
                            inlineLink("Lyrics.ovh", url: lyricsOvhURL)
                        }
                    }

                    aboutSection("Privacy") {
                        Text("The native app keeps favorites, recents, custom stations, theme choice, wake alarm, sleep timer state, and cached catalog data on device. It does not need an account.")
                        Text("We do not collect analytics in the iOS app and we collect no other user data. Playing radio and fetching catalog, metadata, schedules, artwork, and lyrics necessarily contacts rrradio.org, station hosts, Radio Browser, Apple services, LRCLIB, or Lyrics.ovh depending on what you use.")
                        inlineLink("Read the full privacy policy", url: privacyURL)
                    }

                    aboutSection("Source") {
                        Text("rrradio is open source.")
                        linkButton("View on GitHub", systemImage: "chevron.left.forwardslash.chevron.right", url: githubURL, filled: true)
                    }

                    aboutSection("Feedback") {
                        Text("Found a bug, a broken station, or have a feature idea? The fastest way to reach the maintainer is to open an issue. Email works too.")
                        VStack(spacing: 10) {
                            linkButton("Open an issue", systemImage: "plus.circle", url: issueURL, filled: true)
                            linkButton("Email", systemImage: "envelope", url: emailURL, filled: false)
                        }
                    }

                    aboutSection("Imprint") {
                        Text("rrradio.org is a non-commercial side project.")
                        inlineLink("Open imprint", url: imprintURL)
                    }

                    Text("No ads, no account, and no other data collection.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink4)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .multilineTextAlignment(.center)
                        .padding(.top, 4)
                }
                .font(.system(size: 14))
                .foregroundStyle(RrradioTheme.ink2)
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 32)
        }
    }

    private func aboutSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.4)
                .foregroundStyle(RrradioTheme.ink3)
            content()
                .lineSpacing(3)
        }
    }

    private func bulletList(_ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 9) {
                    Text("-")
                        .foregroundStyle(RrradioTheme.accent)
                    Text(item)
                }
            }
        }
    }

    private func featureRow(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(RrradioTheme.accent)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(RrradioTheme.ink3)
            }
        }
    }

    private func inlineLink(_ title: String, url: URL) -> some View {
        Link(destination: url) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(RrradioTheme.line)
                        .frame(height: 1)
                        .offset(y: 2)
                }
        }
    }

    private func linkButton(_ title: String, systemImage: String, url: URL, filled: Bool) -> some View {
        Link(destination: url) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .medium))
                Text(title)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(filled ? RrradioTheme.bg : RrradioTheme.ink)
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(filled ? RrradioTheme.buttonFill : RrradioTheme.bg2)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(filled ? RrradioTheme.buttonFill : RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }
}

struct SheetChromeHeader: View {
    let title: String
    var titleAlignment: Alignment = .leading
    let dismiss: () -> Void

    var body: some View {
        ZStack {
            Text(title)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.6)
                .foregroundStyle(RrradioTheme.ink3)
                .frame(maxWidth: .infinity, alignment: titleAlignment)

            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink2)
                        .frame(width: 36, height: 36)
                        .overlay(Circle().stroke(RrradioTheme.line))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
        }
        .padding(.leading, 24)
        .padding(.trailing, 18)
        .padding(.vertical, 10)
        .background(RrradioTheme.bg)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }
}
