import Foundation
import WatchConnectivity

@MainActor
final class PhoneRemoteControlController: NSObject, WCSessionDelegate {
    static let shared = PhoneRemoteControlController()

    private static let favoriteSnapshotLimit = 30
    private static let pendingCommandLimit = 5

    private weak var catalog: Catalog?
    private weak var library: Library?
    private weak var player: AudioPlayer?
    private var pendingCommands: [WatchPlaybackCommandEnvelope] = []

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    private var isConfigured: Bool {
        catalog != nil && library != nil && player != nil
    }

    private override init() {
        super.init()
    }

    func activate() {
        guard let session else { return }
        session.delegate = self
        session.activate()
    }

    func configure(catalog: Catalog, library: Library, player: AudioPlayer) {
        self.catalog = catalog
        self.library = library
        self.player = player
        activate()
        drainPendingCommands()
        publishSnapshot()
    }

    func publishSnapshot() {
        guard let session,
              session.activationState == .activated,
              session.isPaired,
              session.isWatchAppInstalled else {
            return
        }
        do {
            try session.updateApplicationContext(WatchRemoteMessageCodec.message(for: makeSnapshot()))
        } catch {
            diagnosticRecord("watch", "snapshot publish failed", details: ["error": error.localizedDescription])
        }
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?,
    ) {
        Task { @MainActor [weak self] in
            if let error {
                diagnosticRecord("watch", "activation failed", details: ["error": error.localizedDescription])
            } else {
                diagnosticRecord("watch", "activation completed", details: ["state": String(activationState.rawValue)])
            }
            self?.publishSnapshot()
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void,
    ) {
        Task { @MainActor [weak self] in
            let reply = self?.handleMessage(message) ?? [:]
            replyHandler(reply)
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {
    }

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        Task { @MainActor [weak self] in
            self?.activate()
        }
    }

    private func handleMessage(_ message: [String: Any]) -> [String: Any] {
        do {
            if let command = try WatchRemoteMessageCodec.command(from: message) {
                handle(command)
            }
            return try WatchRemoteMessageCodec.message(for: makeSnapshot())
        } catch {
            diagnosticRecord("watch", "message handling failed", details: ["error": error.localizedDescription])
            return [:]
        }
    }

    private func handle(_ command: WatchPlaybackCommandEnvelope) {
        guard isConfigured else {
            enqueue(command)
            return
        }

        switch command.kind {
        case .playStation:
            guard let stationID = command.stationID else { return }
            playStation(id: stationID)

        case .pause:
            player?.pause()

        case .resume:
            player?.resume()

        case .toggle:
            player?.toggle()

        case .stop:
            player?.stop()

        case .nextFavorite:
            playFavoriteStep(direction: .forward)

        case .previousFavorite:
            playFavoriteStep(direction: .backward)

        case .requestSnapshot:
            break
        }

        publishSnapshot()
    }

    private func enqueue(_ command: WatchPlaybackCommandEnvelope) {
        pendingCommands.append(command)
        if pendingCommands.count > Self.pendingCommandLimit {
            pendingCommands.removeFirst(pendingCommands.count - Self.pendingCommandLimit)
        }
    }

    private func drainPendingCommands() {
        let commands = pendingCommands
        pendingCommands.removeAll()
        commands.forEach(handle)
    }

    private func playStation(id stationID: String) {
        guard let station = station(id: stationID), let library, let player else { return }
        let queue = StationPlaybackQueue(source: .favorites, stations: library.favorites, current: station)
        player.play(station, queue: queue)
        library.pushRecent(station)
    }

    private func playFavoriteStep(direction: StationStepDirection) {
        guard let library, let player, !library.favorites.isEmpty else { return }

        let favorites = library.favorites
        let station: Station
        if let current = player.current,
           let currentIndex = favorites.firstIndex(where: { $0.id == current.id }) {
            switch direction {
            case .backward:
                station = favorites[(currentIndex - 1 + favorites.count) % favorites.count]
            case .forward:
                station = favorites[(currentIndex + 1) % favorites.count]
            }
        } else {
            station = direction == .forward ? favorites[0] : favorites[favorites.count - 1]
        }

        let queue = StationPlaybackQueue(source: .favorites, stations: favorites, current: station)
        player.play(station, queue: queue)
        library.pushRecent(station)
    }

    private func station(id stationID: String) -> Station? {
        guard let catalog, let library else { return nil }
        let candidates = library.favorites + library.customStations + catalog.stations
        return candidates.first { $0.id == stationID }
    }

    private func makeSnapshot() -> WatchPlaybackSnapshot {
        let player = player
        let favorites = library?.favorites.prefix(Self.favoriteSnapshotLimit).map(WatchStationSummary.init(station:)) ?? []
        return WatchPlaybackSnapshot(
            playbackState: player.map(Self.playbackState) ?? .idle,
            currentStation: player?.current.map(WatchStationSummary.init(station:)),
            nowPlayingTitle: player?.nowPlayingTitle,
            nowPlayingArtist: player?.nowPlayingArtist,
            nowPlayingProgramName: player?.nowPlayingProgramName,
            nowPlayingCoverURL: player?.nowPlayingCoverUrl ?? player?.current?.favicon,
            favorites: Array(favorites),
            catalogStationCount: catalog?.stations.count ?? 0,
            generatedAt: Date(),
        )
    }

    private static func playbackState(for player: AudioPlayer) -> WatchRemotePlaybackState {
        switch player.state {
        case .idle:
            return .idle
        case .loading:
            return .loading
        case .playing:
            return .playing
        case .paused:
            return .paused
        case .error:
            return .error
        }
    }
}

private extension WatchStationSummary {
    init(station: Station) {
        self.init(
            id: station.id,
            name: station.name,
            broadcaster: station.broadcaster,
            country: station.country,
            favicon: station.favicon,
        )
    }
}
