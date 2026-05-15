import Combine
import Foundation
import WatchConnectivity

@MainActor
final class WatchRemoteModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var snapshot = WatchPlaybackSnapshot.empty()
    @Published private(set) var isReachable = false
    @Published private(set) var isSending = false
    @Published private(set) var lastError: String?

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    var isPlaying: Bool {
        snapshot.playbackState == .playing || snapshot.playbackState == .loading
    }

    var canSendCommand: Bool {
        isReachable && !isSending
    }

    var canStepStations: Bool {
        snapshot.activeQueue.map { $0.stationCount > 1 } ?? false
    }

    override init() {
        super.init()
        activate()
    }

    func activate() {
        guard let session else {
            lastError = "Watch remote is unavailable."
            return
        }
        session.delegate = self
        session.activate()
        isReachable = session.isReachable
        applyApplicationContext(session.receivedApplicationContext)
    }

    func refresh() {
        send(.requestSnapshot)
    }

    func playStation(id stationID: String) {
        send(.playStation, stationID: stationID)
    }

    func playActiveQueueStation(id stationID: String) {
        send(.playActiveQueueStation, stationID: stationID)
    }

    func playStationList(id stationListID: String) {
        send(.playStationList, stationListID: stationListID)
    }

    func primaryPlaybackAction() {
        if isPlaying {
            send(.pause)
        } else if snapshot.currentStation != nil {
            send(.resume)
        } else if let firstList = snapshot.stationLists.first, firstList.stationCount > 0 {
            send(.playStationList, stationListID: firstList.id)
        } else if let firstFavorite = snapshot.favorites.first {
            send(.playStation, stationID: firstFavorite.id)
        }
    }

    func previousStation() {
        send(.previousStation)
    }

    func nextStation() {
        send(.nextStation)
    }

    func stop() {
        send(.stop)
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?,
    ) {
        Task { @MainActor [weak self] in
            self?.isReachable = session.isReachable
            self?.lastError = error.map { "iPhone connection failed: \($0.localizedDescription)" }
            self?.applyApplicationContext(session.receivedApplicationContext)
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in
            self?.isReachable = session.isReachable
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any],
    ) {
        Task { @MainActor [weak self] in
            self?.applyApplicationContext(applicationContext)
        }
    }

    private func send(_ kind: WatchPlaybackCommandKind, stationID: String? = nil, stationListID: String? = nil) {
        guard let session, session.activationState == .activated else {
            lastError = "iPhone connection is not ready."
            return
        }
        guard session.isReachable else {
            lastError = "Open rrradio on the iPhone."
            return
        }

        do {
            isSending = true
            lastError = nil
            let command = WatchPlaybackCommandEnvelope(kind: kind, stationID: stationID, stationListID: stationListID)
            let message = try WatchRemoteMessageCodec.message(for: command)
            session.sendMessage(message) { [weak self] reply in
                Task { @MainActor in
                    self?.isSending = false
                    self?.applySnapshotReply(reply)
                }
            } errorHandler: { [weak self] error in
                Task { @MainActor in
                    self?.isSending = false
                    self?.lastError = error.localizedDescription
                }
            }
        } catch {
            isSending = false
            lastError = error.localizedDescription
        }
    }

    private func applyApplicationContext(_ context: [String: Any]) {
        guard !context.isEmpty else { return }
        applySnapshotReply(context)
    }

    private func applySnapshotReply(_ message: [String: Any]) {
        do {
            guard let snapshot = try WatchRemoteMessageCodec.snapshot(from: message) else { return }
            self.snapshot = snapshot
            lastError = nil
        } catch {
            lastError = "Could not read iPhone state."
        }
    }
}
