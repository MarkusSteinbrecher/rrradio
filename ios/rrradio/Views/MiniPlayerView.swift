import SwiftUI

/// Persistent bottom bar mirroring the web app's mini player: shows
/// the current station, current track (when known), and a play/pause
/// button. Tap anywhere to expand → NowPlayingView.
struct MiniPlayerView: View {
    @Environment(AudioPlayer.self) private var player
    @State private var presentNowPlaying = false

    var body: some View {
        Button {
            presentNowPlaying = true
        } label: {
            HStack(spacing: 12) {
                FaviconView(url: player.current?.favicon)
                VStack(alignment: .leading, spacing: 1) {
                    Text(player.current?.name ?? "")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                playPauseButton
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.thinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $presentNowPlaying) {
            NowPlayingView()
                .presentationDetents([.large])
        }
    }

    private var subtitle: String {
        switch player.state {
        case .loading:           return "loading…"
        case .error(let msg):    return "error: \(msg)"
        default: break
        }
        if let title = player.nowPlayingTitle {
            if let artist = player.nowPlayingArtist { return "\(artist) — \(title)" }
            return title
        }
        return player.current?.country?.uppercased() ?? ""
    }

    private var playPauseButton: some View {
        Button {
            player.toggle()
        } label: {
            Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                .font(.title2)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    MiniPlayerView()
        .environment(AudioPlayer())
}
