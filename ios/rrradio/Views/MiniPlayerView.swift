import SwiftUI

/// Persistent bottom strip mirroring the web app's mini player.
struct MiniPlayerView: View {
    @Environment(AudioPlayer.self) private var player
    @State private var presentNowPlaying = false

    var body: some View {
        HStack(spacing: 14) {
            FaviconView(
                url: player.nowPlayingCoverUrl ?? player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
            )
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(player.current?.name ?? "")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                subtitleLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)

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
        .padding(.leading, 20)
        .padding(.trailing, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 66)
        .background(RrradioTheme.bg2)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
        .overlay(alignment: .topLeading) {
            if player.state == .playing {
                MiniStreamingLine()
                    .frame(height: 1)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            presentNowPlaying = true
        }
        .sheet(isPresented: $presentNowPlaying) {
            NowPlayingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
    }

    @ViewBuilder
    private var subtitleLine: some View {
        if let track = trackLine {
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

    private var trackLine: String? {
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
}

private struct MiniStreamingLine: View {
    var body: some View {
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.4) / 2.4
            GeometryReader { proxy in
                let width = max(proxy.size.width, 1)
                let segment = width * 0.42
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [.clear, RrradioTheme.accent.opacity(0.72), .clear],
                            startPoint: .leading,
                            endPoint: .trailing,
                        ),
                    )
                    .frame(width: segment)
                    .offset(x: (width + segment) * phase - segment)
            }
        }
        .allowsHitTesting(false)
    }
}

#Preview {
    MiniPlayerView()
        .environment(AudioPlayer())
}
