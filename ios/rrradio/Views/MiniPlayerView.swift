import SwiftUI
import UIKit

/// Persistent bottom strip mirroring the web app's mini player.
struct MiniPlayerView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(NetworkMonitor.self) private var network
    @Environment(ThemeController.self) private var theme
    @State private var presentNowPlaying = false
    @State private var showingClosePrompt = false
    private let offlineTint = Color(red: 1, green: 0.45, blue: 0.45)
    private let miniPlayerHeight: CGFloat = 104
    private let stationArtworkSize: CGFloat = 46
    private let albumArtworkSize: CGFloat = 64
    private let controlSize: CGFloat = 36

    var body: some View {
        // Track accent so the mini player updates when the user changes
        // it in Settings (see StationListView for the full explanation).
        let _ = theme.accentRawValue
        return HStack(spacing: 14) {
            leadingIcon

            metadataLines
            .frame(maxWidth: .infinity, alignment: .leading)

            if sleepTimer.isArmed {
                Image(systemName: "moon.zzz.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(RrradioTheme.accent)
                    .frame(width: 24, height: controlSize)
                    .accessibilityLabel("Sleep timer active")
            }

            if let artworkURL = albumArtworkURL {
                NowPlayingArtworkThumb(
                    url: artworkURL,
                    size: albumArtworkSize,
                    showsBorder: false
                )
                .frame(width: albumArtworkSize, height: albumArtworkSize)
            }

            if player.current == nil, network.snapshot.isOffline {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(offlineTint.opacity(0.82))
                    .frame(width: controlSize, height: controlSize)
                    .overlay(Circle().stroke(offlineTint.opacity(0.22), lineWidth: 1))
                    .accessibilityHidden(true)
            } else if showingClosePrompt {
                Button {
                    closePlayer()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: controlSize, height: controlSize)
                        .background(Color.red)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(player.current == nil)
                .accessibilityLabel("Close mini player")
                .transition(.scale(scale: 0.92).combined(with: .opacity))
            } else {
                Button {
                    player.toggle()
                } label: {
                    Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink)
                        .frame(width: controlSize, height: controlSize)
                        .overlay(Circle().stroke(RrradioTheme.ink.opacity(0.16), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(player.current == nil || player.state == .loading)
                .accessibilityLabel(player.state == .playing ? "Pause" : "Play")
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 20)
        .padding(.vertical, 16)
        .frame(height: miniPlayerHeight)
        .background(RrradioTheme.bg2)
        .overlay(alignment: .top) {
            MiniPlayerTopRule(isActive: player.current != nil || network.snapshot.isOffline, tint: topRuleTint)
        }
        .contentShape(Rectangle())
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.45)
                .onEnded { _ in
                    showClosePrompt()
                },
        )
        .onTapGesture {
            guard player.current != nil else { return }
            guard !showingClosePrompt else {
                withAnimation(.snappy(duration: 0.12)) {
                    showingClosePrompt = false
                }
                return
            }
            presentNowPlaying = true
        }
        .sheet(isPresented: $presentNowPlaying) {
            NowPlayingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
        .onChange(of: player.current?.id) { _, stationID in
            guard stationID == nil else { return }
            showingClosePrompt = false
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
            .frame(width: stationArtworkSize, height: stationArtworkSize)
        } else {
            ZStack(alignment: .topTrailing) {
                FaviconView(
                    url: player.current?.favicon,
                    stationName: player.current?.name ?? "",
                    stationID: player.current?.id ?? "",
                    size: stationArtworkSize,
                )
                .frame(width: stationArtworkSize, height: stationArtworkSize)

                if isStationListPlayback {
                    stationListBadge
                        .offset(x: 4, y: -4)
                }
            }
            .frame(width: stationArtworkSize, height: stationArtworkSize)
        }
    }

    private var stationListBadge: some View {
        Image(systemName: "list.bullet")
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(RrradioTheme.accent)
            .frame(width: 18, height: 18)
            .background(Circle().fill(RrradioTheme.bg2))
            .overlay(Circle().stroke(RrradioTheme.accent.opacity(0.55), lineWidth: 1))
            .accessibilityLabel("Playing from list")
    }

    private var albumArtworkURL: URL? {
        guard player.current != nil, !network.snapshot.isOffline else {
            return nil
        }
        return player.nowPlayingCoverUrl
    }

    @ViewBuilder
    private var metadataLines: some View {
        VStack(alignment: .leading, spacing: 4) {
            stationTitleLine

            if !network.snapshot.isOffline {
                if let track = trackLine {
                    detailText(track, color: RrradioTheme.ink2)
                }

                if let program = programInfoLine {
                    detailText(program, color: RrradioTheme.ink3)
                } else if trackLine == nil {
                    stateLineView
                }
            }
        }
    }

    @ViewBuilder
    private var stationTitleLine: some View {
        if network.snapshot.isOffline {
            HStack(spacing: 6) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 9.5, weight: .semibold))
                Text("No internet connection")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .lineLimit(1)
            }
            .foregroundStyle(offlineTint.opacity(0.90))
        } else {
            HStack(spacing: 4) {
                Text(player.current?.name ?? "")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                let flag = countryFlagEmoji(player.current?.country)
                if !flag.isEmpty {
                    Text(flag)
                        .font(.system(size: 12))
                        .foregroundStyle(.primary)
                }
                if hasProgramInfo {
                    Image(systemName: "calendar")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink3)
                        .accessibilityLabel("Program info")
                }
            }
        }
    }

    private func detailText(_ value: String, color: Color) -> some View {
        Text(value)
            .font(.system(size: 11.5))
            .foregroundStyle(color)
            .lineLimit(1)
    }

    private var stateLineView: some View {
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

    private var programInfoLine: String? {
        let line = [
            clean(player.nowPlayingProgramName),
            clean(player.nowPlayingProgramSubtitle),
        ]
        .compactMap { $0 }
        .joined(separator: " . ")
        return line.isEmpty ? nil : line
    }

    private var isStationListPlayback: Bool {
        player.activePlaybackQueueSource == .stationList
    }

    private var hasProgramInfo: Bool {
        guard let station = player.current else {
            return programInfoLine != nil
        }
        return stationHasProgramInfo(station) || programInfoLine != nil
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
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
        case .error(let message):
            // Short enough to fit the miniplayer — the regular geo
            // message is "Switzerland only — region-locked by the
            // broadcaster.", which would truncate. Trim to the
            // country phrase ahead of the em-dash when present, fall
            // back to the message otherwise.
            if let dash = message.range(of: " — "), dash.lowerBound > message.startIndex {
                return String(message[..<dash.lowerBound])
            }
            return message
        }
    }

    private var topRuleTint: Color {
        network.snapshot.isOffline ? offlineTint.opacity(0.70) : RrradioTheme.accent
    }

    private func showClosePrompt() {
        guard player.current != nil else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.snappy(duration: 0.12)) {
            showingClosePrompt = true
        }
    }

    private func closePlayer() {
        withAnimation(.snappy(duration: 0.12)) {
            showingClosePrompt = false
        }
        presentNowPlaying = false
        player.stop()
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
