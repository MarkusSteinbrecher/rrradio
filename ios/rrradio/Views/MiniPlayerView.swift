import SwiftUI

/// Persistent bottom strip mirroring the web app's mini player.
struct MiniPlayerView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(NetworkMonitor.self) private var network
    @State private var presentNowPlaying = false
    private let offlineTint = Color(red: 1, green: 0.45, blue: 0.45)

    var body: some View {
        HStack(spacing: 14) {
            leadingIcon

            VStack(alignment: .leading, spacing: 2) {
                Text(primaryLine)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(primaryColor)
                    .lineLimit(1)
                subtitleLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if sleepTimer.isArmed {
                Image(systemName: "moon.zzz.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(RrradioTheme.accent)
                    .frame(width: 24, height: 36)
                    .accessibilityLabel("Sleep timer active")
            }

            if player.current == nil, network.snapshot.isOffline {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(offlineTint.opacity(0.82))
                    .frame(width: 36, height: 36)
                    .overlay(Circle().stroke(offlineTint.opacity(0.22), lineWidth: 1))
                    .accessibilityHidden(true)
            } else {
                Button {
                    player.toggle()
                } label: {
                    Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink)
                        .frame(width: 36, height: 36)
                        .overlay(Circle().stroke(RrradioTheme.ink.opacity(0.16), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(player.current == nil || player.state == .loading)
                .accessibilityLabel(player.state == .playing ? "Pause" : "Play")
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 66)
        .background(RrradioTheme.bg2)
        .overlay(alignment: .top) {
            MiniPlayerTopRule(isActive: player.current != nil || network.snapshot.isOffline, tint: topRuleTint)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard player.current != nil else { return }
            presentNowPlaying = true
        }
        .sheet(isPresented: $presentNowPlaying) {
            NowPlayingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
    }

    @ViewBuilder
    private var leadingIcon: some View {
        if player.current == nil, network.snapshot.isOffline {
            ZStack {
                Circle()
                    .fill(offlineTint.opacity(0.10))
                    .overlay(Circle().stroke(offlineTint.opacity(0.24), lineWidth: 1))
                Image(systemName: "wifi.slash")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(offlineTint.opacity(0.82))
            }
            .frame(width: 38, height: 38)
        } else {
            FaviconView(
                url: player.nowPlayingCoverUrl ?? player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
                size: 38,
            )
            .frame(width: 38, height: 38)
        }
    }

    @ViewBuilder
    private var subtitleLine: some View {
        if network.snapshot.isOffline {
            HStack(spacing: 6) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 9.5, weight: .semibold))
                Text("No internet connection")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .lineLimit(1)
            }
            .foregroundStyle(offlineTint.opacity(0.86))
        } else if let track = trackLine {
            Text(track)
                .font(.system(size: 11.5))
                .foregroundStyle(RrradioTheme.ink2)
                .lineLimit(1)
        } else {
            HStack(spacing: 6) {
                if player.state == .playing {
                    Circle()
                        .fill(RrradioTheme.accent)
                        .frame(width: 5, height: 5)
                }
                Text(stateLine)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(RrradioTheme.ink3)
                    .lineLimit(1)
            }
        }
    }

    private var primaryLine: String {
        if player.current == nil, network.snapshot.isOffline {
            return "No internet connection"
        }
        let stationName = player.current?.name ?? ""
        guard let programName = player.nowPlayingProgramName?.trimmingCharacters(in: .whitespacesAndNewlines), !programName.isEmpty else {
            return stationName
        }
        return "\(stationName) - \(programName)"
    }

    private var trackLine: String? {
        guard !network.snapshot.isOffline else { return nil }
        guard player.state != .loading else { return nil }
        if let title = player.nowPlayingTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            if let artist = player.nowPlayingArtist?.trimmingCharacters(in: .whitespacesAndNewlines), !artist.isEmpty {
                return "\(artist) - \(title)"
            }
            return title
        }
        return nil
    }

    private var stateLine: String {
        switch player.state {
        case .idle:
            return player.current?.country?.uppercased() ?? "Standby"
        case .loading:
            return "Loading"
        case .playing:
            return "Live"
        case .paused:
            return "Paused"
        case .error:
            return "Error"
        }
    }

    private var primaryColor: Color {
        player.current == nil && network.snapshot.isOffline ? offlineTint.opacity(0.90) : RrradioTheme.ink
    }

    private var topRuleTint: Color {
        network.snapshot.isOffline ? offlineTint.opacity(0.70) : RrradioTheme.accent
    }
}

private struct MiniPlayerTopRule: View {
    let isActive: Bool
    let tint: Color

    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(isActive ? tint : RrradioTheme.line)
                .frame(height: isActive ? 2 : 1)
            Spacer(minLength: 0)
        }
        .allowsHitTesting(false)
    }
}

#Preview {
    MiniPlayerView()
        .environment(AudioPlayer())
        .environment(SleepTimer())
        .environment(NetworkMonitor(startsAutomatically: false))
}
