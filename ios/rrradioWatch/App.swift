import SwiftUI

@main
struct RrradioWatchApp: App {
    @StateObject private var model = WatchRemoteModel()

    var body: some Scene {
        WindowGroup {
            WatchRemoteRootView(model: model)
        }
    }
}

struct WatchRemoteRootView: View {
    @ObservedObject var model: WatchRemoteModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    connectionRow
                    nowPlayingSection
                    controls
                    favoritesSection
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            }
            .navigationTitle("rrradio")
            .onAppear { model.refresh() }
        }
    }

    private var connectionRow: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(model.isReachable ? Color.green : Color.orange)
                .frame(width: 7, height: 7)
            Text(model.isReachable ? "iPhone ready" : "Open iPhone app")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 4)
            Button {
                model.refresh()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .disabled(!model.canSendCommand)
            .accessibilityLabel("Refresh")
        }
    }

    private var nowPlayingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                RemoteArtwork(
                    url: model.snapshot.nowPlayingCoverURL ?? model.snapshot.currentStation?.favicon,
                    size: 60,
                )
                VStack(alignment: .leading, spacing: 2) {
                    Text(nowPlayingHeadline)
                        .font(.headline)
                        .lineLimit(2)
                    if let subheadline = nowPlayingSubheadline {
                        Text(subheadline)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    if model.snapshot.playbackState == .loading {
                        ProgressView()
                            .controlSize(.mini)
                    }
                }
            }

            if let stationName = model.snapshot.currentStation?.name,
               stationName != nowPlayingHeadline {
                Text(stationName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if model.snapshot.playbackState == .error {
                Text("Playback error")
                    .font(.caption2)
                    .foregroundStyle(.red)
            } else if let lastError = model.lastError {
                Text(lastError)
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .lineLimit(2)
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 8) {
            Button {
                model.previousFavorite()
            } label: {
                Image(systemName: "backward.fill")
            }
            .disabled(!model.canSendCommand || model.snapshot.favorites.count < 2)
            .accessibilityLabel("Previous favorite")

            Button {
                model.primaryPlaybackAction()
            } label: {
                Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
            }
            .disabled(!model.canSendCommand || (model.snapshot.currentStation == nil && model.snapshot.favorites.isEmpty))
            .accessibilityLabel(model.isPlaying ? "Pause" : "Play")

            Button {
                model.nextFavorite()
            } label: {
                Image(systemName: "forward.fill")
            }
            .disabled(!model.canSendCommand || model.snapshot.favorites.count < 2)
            .accessibilityLabel("Next favorite")

            Button {
                model.stop()
            } label: {
                Image(systemName: "stop.fill")
            }
            .disabled(!model.canSendCommand || model.snapshot.currentStation == nil)
            .accessibilityLabel("Stop")
        }
        .font(.body.weight(.semibold))
        .buttonStyle(.bordered)
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Favorites")
                .font(.caption)
                .foregroundStyle(.secondary)

            if model.snapshot.favorites.isEmpty {
                Text("No favorites yet")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.snapshot.favorites) { station in
                    Button {
                        model.playStation(id: station.id)
                    } label: {
                        FavoriteStationRow(station: station)
                    }
                    .disabled(!model.canSendCommand)
                }
            }
        }
    }

    private var nowPlayingHeadline: String {
        model.snapshot.nowPlayingTitle
            ?? model.snapshot.nowPlayingProgramName
            ?? model.snapshot.currentStation?.name
            ?? "No station"
    }

    private var nowPlayingSubheadline: String? {
        model.snapshot.nowPlayingArtist
            ?? model.snapshot.currentStation?.broadcaster
            ?? model.snapshot.currentStation?.country
    }
}

private struct FavoriteStationRow: View {
    let station: WatchStationSummary

    var body: some View {
        HStack(spacing: 8) {
            RemoteArtwork(url: station.favicon, size: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(station.name)
                    .font(.caption)
                    .lineLimit(1)
                if let detail = station.broadcaster ?? station.country {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct RemoteArtwork: View {
    let url: URL?
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.secondary.opacity(0.18))

            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .controlSize(.mini)
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        Image(systemName: "dot.radiowaves.left.and.right")
                            .font(.system(size: size * 0.38))
                            .foregroundStyle(.secondary)
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .font(.system(size: size * 0.38))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
