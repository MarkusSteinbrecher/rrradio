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
                    if let stationListBoundaryText {
                        boundaryText(stationListBoundaryText)
                    }
                }
            }
        }
    }

    private var nowPlayingPage: some View {
        WatchPageScrollView {
            VStack(alignment: .leading, spacing: 10) {
                nowPlayingLogoHeader

                VStack(alignment: .center, spacing: 9) {
                    nowPlayingSection
                    controls
                    connectionStatus
                }
                .frame(maxWidth: .infinity)

                activeQueueSection
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

    private var nowPlayingLogoHeader: some View {
        HStack {
            Image("RrradioLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 24, height: 24)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
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
            nowPlayingArtworkPair

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

    private var nowPlayingArtworkPair: some View {
        HStack(alignment: .center, spacing: 10) {
            RemoteArtwork(
                url: model.snapshot.nowPlayingCoverURL,
                size: 70,
                placeholderSystemName: "music.note",
            )

            RemoteArtwork(
                url: model.snapshot.currentStation?.favicon,
                size: 48,
            )
        }
        .frame(maxWidth: .infinity, alignment: .center)
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
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(minimum: 42), spacing: 7), count: 3),
                    alignment: .center,
                    spacing: 8,
                ) {
                    ForEach(model.snapshot.favorites) { station in
                        Button {
                            model.playStation(id: station.id)
                        } label: {
                            FavoriteStationTile(
                                station: station,
                                isCurrent: station.id == model.snapshot.currentStation?.id,
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(!model.canSendCommand)
                    }
                }
                if let favoritesBoundaryText {
                    boundaryText(favoritesBoundaryText)
                }
            }
        }
    }

    @ViewBuilder
    private var activeQueueSection: some View {
        let stations = activeQueueStations
        if !stations.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                pageHeader(title: activeQueueTitle, systemImage: activeQueueIcon)

                ForEach(stations) { station in
                    Button {
                        model.playActiveQueueStation(id: station.id)
                    } label: {
                        ActiveQueueStationRow(
                            station: station,
                            isCurrent: station.id == model.snapshot.currentStation?.id,
                        )
                    }
                    .disabled(!model.canSendCommand)
                }
                if let activeQueueBoundaryText {
                    boundaryText(activeQueueBoundaryText)
                }
            }
            .padding(.top, 4)
        }
    }

    private var activeQueueStations: [WatchStationSummary] {
        guard let activeQueue = model.snapshot.activeQueue else { return [] }
        if model.snapshot.activeQueueStations.isEmpty, activeQueue.source == .favorites {
            return model.snapshot.favorites
        }
        return model.snapshot.activeQueueStations
    }

    private var activeQueueTitle: String {
        model.snapshot.activeQueue?.name ?? model.snapshot.activeQueue?.source.displayName ?? "Queue"
    }

    private var activeQueueIcon: String {
        switch model.snapshot.activeQueue?.source {
        case .favorites:
            return "heart"
        case .stationList:
            return "list.bullet.rectangle"
        default:
            return "music.note.list"
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

    private var favoritesBoundaryText: String? {
        boundaryText(
            shown: model.snapshot.favorites.count,
            total: model.snapshot.favoriteCount,
            noun: "favorites",
        )
    }

    private var stationListBoundaryText: String? {
        boundaryText(
            shown: model.snapshot.stationLists.count,
            total: model.snapshot.stationListCount,
            noun: "lists",
        )
    }

    private var activeQueueBoundaryText: String? {
        guard let total = model.snapshot.activeQueue?.stationCount else { return nil }
        return boundaryText(
            shown: activeQueueStations.count,
            total: total,
            noun: "stations",
        )
    }

    private func boundaryText(shown: Int, total: Int, noun: String) -> String? {
        guard total > shown else { return nil }
        return "Showing \(shown) of \(total) \(noun)"
    }

    private func boundaryText(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 2)
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

private struct ActiveQueueStationRow: View {
    let station: WatchStationSummary
    let isCurrent: Bool

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
            Spacer(minLength: 0)
            if isCurrent {
                Image(systemName: "speaker.wave.2.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.yellow)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FavoriteStationTile: View {
    let station: WatchStationSummary
    let isCurrent: Bool

    var body: some View {
        VStack(spacing: 4) {
            ZStack(alignment: .topTrailing) {
                RemoteArtwork(url: station.favicon, size: 44)
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(isCurrent ? Color.yellow : Color.clear, lineWidth: 2)
                    }

                if isCurrent {
                    Circle()
                        .fill(Color.yellow)
                        .frame(width: 10, height: 10)
                        .offset(x: 2, y: -2)
                }
            }

            Text(station.name)
                .font(.system(size: 9, weight: .medium))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, minHeight: 22, alignment: .top)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct RemoteArtwork: View {
    let url: URL?
    let size: CGFloat
    let placeholderSystemName: String

    init(url: URL?, size: CGFloat, placeholderSystemName: String = "dot.radiowaves.left.and.right") {
        self.url = url
        self.size = size
        self.placeholderSystemName = placeholderSystemName
    }

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
                        placeholderIcon
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                placeholderIcon
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var placeholderIcon: some View {
        Image(systemName: placeholderSystemName)
            .font(.system(size: size * 0.38))
            .foregroundStyle(.secondary)
    }
}
