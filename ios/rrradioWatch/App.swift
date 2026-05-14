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
    @State private var page: WatchRemotePage = .lists

    var body: some View {
        TabView(selection: $page) {
            listsPage
                .tag(WatchRemotePage.lists)

            nowPlayingPage
                .tag(WatchRemotePage.nowPlaying)

            favoritesPage
                .tag(WatchRemotePage.favorites)
        }
        .tabViewStyle(.page(indexDisplayMode: .automatic))
        .onAppear { model.refresh() }
    }

    private var listsPage: some View {
        WatchPageScrollView {
            VStack(alignment: .leading, spacing: 8) {
                pageHeader(title: "Lists", systemImage: "list.bullet.rectangle")

                if model.snapshot.stationLists.isEmpty {
                    Text("No lists yet")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 18)
                } else {
                    ForEach(model.snapshot.stationLists) { list in
                        Button {
                            model.playStationList(id: list.id)
                        } label: {
                            StationListSummaryRow(list: list)
                        }
                        .disabled(!model.canSendCommand || list.stationCount == 0)
                    }
                }
            }
        }
    }

    private var nowPlayingPage: some View {
        WatchPageScrollView {
            VStack(alignment: .center, spacing: 9) {
                nowPlayingSection
                controls
                connectionStatus
            }
        }
    }

    private var favoritesPage: some View {
        WatchPageScrollView {
            VStack(alignment: .leading, spacing: 8) {
                pageHeader(title: "Favorites", systemImage: "heart")
                favoritesSection
            }
        }
    }

    private func pageHeader(title: String, systemImage: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
    }

    private var connectionStatus: some View {
        VStack(spacing: 3) {
            HStack(spacing: 6) {
                Circle()
                    .fill(model.isReachable ? Color.green : Color.orange)
                    .frame(width: 6, height: 6)
                Text(model.isReachable ? "iPhone ready" : "Open iPhone app")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .center)

            if let lastError = model.lastError {
                Text(lastError)
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var nowPlayingSection: some View {
        VStack(alignment: .center, spacing: 7) {
            RemoteArtwork(
                url: model.snapshot.nowPlayingCoverURL ?? model.snapshot.currentStation?.favicon,
                size: 70,
            )

            VStack(alignment: .center, spacing: 3) {
                Text(nowPlayingHeadline)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                if let subheadline = nowPlayingSubheadline {
                    Text(subheadline)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }

                if let queueLine {
                    Text(queueLine)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }

                if model.snapshot.playbackState == .loading {
                    ProgressView()
                        .controlSize(.mini)
                }
            }

            if model.snapshot.playbackState == .error {
                Text("Playback error")
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var controls: some View {
        HStack(spacing: 7) {
            playbackButton(
                systemName: "backward.fill",
                label: "Previous station",
                disabled: !model.canSendCommand || !model.canStepStations,
            ) {
                model.previousStation()
            }

            playbackButton(
                systemName: model.isPlaying ? "pause.fill" : "play.fill",
                label: model.isPlaying ? "Pause" : "Play",
                disabled: !model.canSendCommand || (model.snapshot.currentStation == nil && model.snapshot.stationLists.isEmpty && model.snapshot.favorites.isEmpty),
            ) {
                model.primaryPlaybackAction()
            }

            playbackButton(
                systemName: "forward.fill",
                label: "Next station",
                disabled: !model.canSendCommand || !model.canStepStations,
            ) {
                model.nextStation()
            }

            playbackButton(
                systemName: "stop.fill",
                label: "Stop",
                disabled: !model.canSendCommand || model.snapshot.currentStation == nil,
            ) {
                model.stop()
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func playbackButton(
        systemName: String,
        label: String,
        disabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 33, height: 33)
                .background(Circle().fill(Color.secondary.opacity(disabled ? 0.10 : 0.20)))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.42 : 1)
        .accessibilityLabel(label)
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            if model.snapshot.favorites.isEmpty {
                Text("No favorites yet")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 18)
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

    private var queueLine: String? {
        guard let queue = model.snapshot.activeQueue,
              queue.stationCount > 1 else { return nil }

        let prefix = queue.name ?? queue.source.displayName
        if let currentIndex = queue.currentIndex {
            return "\(prefix) \(currentIndex + 1)/\(queue.stationCount)"
        }
        return "\(prefix) \(queue.stationCount)"
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

private enum WatchRemotePage: Hashable {
    case lists
    case nowPlaying
    case favorites
}

private struct WatchPageScrollView<Content: View>: View {
    private let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        ScrollView {
            content()
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.horizontal, 6)
                .padding(.vertical, 8)
        }
    }
}

private extension WatchPlaybackQueueSource {
    var displayName: String {
        switch self {
        case .browse:
            return "Browse"
        case .favorites:
            return "Favorites"
        case .recents:
            return "Recents"
        case .stationList:
            return "List"
        case .single:
            return "Station"
        }
    }
}

private struct StationListSummaryRow: View {
    let list: WatchStationListSummary

    var body: some View {
        HStack(spacing: 8) {
            RemoteArtwork(url: list.firstStation?.favicon, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(list.name)
                    .font(.caption)
                    .lineLimit(1)
                Text(stationCountText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var stationCountText: String {
        list.stationCount == 1 ? "1 station" : "\(list.stationCount) stations"
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
