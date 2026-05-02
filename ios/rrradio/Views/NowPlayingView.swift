import SwiftUI

/// Sheet that takes over when the user taps the mini player.
/// Phase-1 surface: station identity + (best-effort) current track +
/// play/pause + close. Favorites, recents, sleep timer, schedule, etc.
/// come iteratively — same shape as the web's NP view.
struct NowPlayingView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            HStack {
                Button("Done") { dismiss() }
                    .font(.body.weight(.medium))
                Spacer()
                Text("Now Playing")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
                    .textCase(.uppercase)
                Spacer()
                Color.clear.frame(width: 44, height: 1)
            }
            .padding(.horizontal)
            .padding(.top, 8)

            Spacer()

            FaviconView(url: player.current?.favicon)
                .frame(width: 240, height: 240)

            VStack(spacing: 6) {
                Text(player.current?.name ?? "")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                if let title = player.nowPlayingTitle {
                    Text(title)
                        .font(.body)
                        .multilineTextAlignment(.center)
                }
                if let artist = player.nowPlayingArtist {
                    Text(artist)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 24)

            Spacer()

            HStack(spacing: 28) {
                Button {
                    player.stop()
                    dismiss()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.title)
                }
                .buttonStyle(.plain)

                Button {
                    player.toggle()
                } label: {
                    Image(systemName: player.state == .playing ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 64))
                }
                .buttonStyle(.plain)

                // Placeholder for future favorite toggle — keeps the
                // three-button layout balanced.
                Button { } label: {
                    Image(systemName: "heart")
                        .font(.title)
                }
                .buttonStyle(.plain)
                .disabled(true)
                .opacity(0.4)
            }
            .padding(.bottom, 40)
        }
    }
}

#Preview {
    NowPlayingView()
        .environment(AudioPlayer())
}
