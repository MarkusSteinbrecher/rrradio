import AVFoundation
import MediaPlayer
import Observation
import UIKit

enum StationStepDirection: Equatable {
    case backward
    case forward
}

struct StationPlaybackQueue: Equatable {
    enum Source: String, Equatable {
        case browse
        case favorites
        case recents
        case stationList
        case single
    }

    let source: Source
    let sourceID: String?
    let stations: [Station]

    init(source: Source, sourceID: String? = nil, stations: [Station], current: Station? = nil) {
        self.source = source
        self.sourceID = sourceID
        self.stations = Self.uniqueStations(stations, current: current)
    }

    func contains(_ station: Station) -> Bool {
        stations.contains { $0.id == station.id }
    }

    func station(from current: Station?, direction: StationStepDirection) -> Station? {
        guard !stations.isEmpty else { return nil }
        guard let current,
              let currentIndex = stations.firstIndex(where: { $0.id == current.id }) else {
            return direction == .forward ? stations.first : stations.last
        }
        guard stations.count > 1 else { return stations[currentIndex] }

        switch direction {
        case .backward:
            return stations[(currentIndex - 1 + stations.count) % stations.count]
        case .forward:
            return stations[(currentIndex + 1) % stations.count]
        }
    }

    func queueInfo(for current: Station) -> StationPlaybackQueueInfo? {
        guard let currentIndex = stations.firstIndex(where: { $0.id == current.id }) else { return nil }
        return StationPlaybackQueueInfo(index: currentIndex, count: stations.count)
    }

    private static func uniqueStations(_ stations: [Station], current: Station?) -> [Station] {
        var seen = Set<String>()
        var unique = stations.filter { station in
            seen.insert(station.id).inserted
        }
        if let current, !seen.contains(current.id) {
            unique.insert(current, at: 0)
        }
        return unique
    }
}

struct StationPlaybackQueueInfo: Equatable {
    let index: Int
    let count: Int
}

private extension FixedWidthInteger {
    var littleEndianBytes: [UInt8] {
        withUnsafeBytes(of: littleEndian) { Array($0) }
    }
}

/// Thin wrapper around AVPlayer with the iOS bits the web app handles
/// via the Media Session API: lock-screen now-playing card, remote
/// commands (play / pause / from AirPods), and audio-session
/// configuration so playback continues in the background.
///
/// v1 surfaces AVPlayer metadata plus selected broadcaster JSON fetchers:
///   - HLS streams: artist + title via AVPlayerItemMetadataOutput
///   - ORF audioapi: polled via the shared catalog's metadataUrl.
///
/// `@MainActor` (audit #72): all observable state must be mutated on
/// the main thread or SwiftUI's @Observable tracking will fire warnings
/// in debug + race in release. KVO change handlers and Combine sinks
/// can fire on any thread — they hop back to main via `Task { @MainActor in }`
/// or `.receive(on:)`.
@Observable
@MainActor
final class AudioPlayer {
    enum State: Equatable { case idle, loading, playing, paused, error(String) }

    private(set) var state: State = .idle
    private(set) var current: Station?
    @ObservationIgnored private(set) var activePlaybackQueue: StationPlaybackQueue?
    private(set) var activePlaybackQueueSource: StationPlaybackQueue.Source = .single
    private(set) var activePlaybackQueueSourceID: String?
    private(set) var nowPlayingTitle: String?
    private(set) var nowPlayingArtist: String?
    private(set) var nowPlayingProgramName: String?
    private(set) var nowPlayingProgramSubtitle: String?
    private(set) var nowPlayingCoverUrl: URL?
    private(set) var nowPlayingSchedule: [ProgramScheduleDay] = []
    private(set) var isScheduleLoading = false
    private(set) var nowPlayingLyrics: LyricsResult?
    private(set) var isLyricsLoading = false

    private var player: AVPlayer?
    private var metadataOutput: AVPlayerItemMetadataOutput?
    private var metadataOutputDelegate: TimedMetadataOutputDelegate?
    private var statusObserver: NSKeyValueObservation?
    private var rateObserver: NSKeyValueObservation?
    private let audioSessionObservers = NotificationObserverStore()
    private let playerItemObservers = NotificationObserverStore()
    private var metadataPoller: MetadataPoller?
    private var scheduleTask: Task<Void, Never>?
    private var lyricsTask: Task<Void, Never>?
    private var coverArtTask: Task<Void, Never>?
    private var streamRetryTask: Task<Void, Never>?
    private var streamRetryAttempt = 0
    private var isStreamRetryScheduled = false
    private var allowsAutomaticStreamRetry = false
    private var shouldResumeAfterInterruption = false
    private var coverArtKey = ""
    private var lockScreenArtworkTask: Task<Void, Never>?
    private var lockScreenArtworkURL: URL?
    private var lockScreenArtworkSourceImage: UIImage?
    private var lockScreenArtwork: MPMediaItemArtwork?
    private var lockScreenSleepTimerFiresAt: Date?
    @ObservationIgnored
    private var lockScreenSleepTimerRefreshTimer: Timer?
    private var shortcutActivity: NSUserActivity?
    private var wakeKeepAlivePlayer: AVAudioPlayer?
    private weak var listeningHistory: ListeningHistory?
    private var lyricsKey = ""

    private static let lockScreenArtworkMaximumBytes = 5_000_000
    private static let lockScreenArtworkTimeout: TimeInterval = 8

    var isWaitingForConnection: Bool {
        if case .error = state {
            return true
        }
        return false
    }

    var shouldAutoResumeAfterConnectivityRestored: Bool {
        guard current != nil else { return false }
        switch state {
        case .loading, .playing, .error:
            return true
        case .idle, .paused:
            return false
        }
    }

    private static let maxStreamRetryAttempts = 3

    private let streamRetryDelayNanoseconds: (Int) -> UInt64

    init(streamRetryDelayNanoseconds: @escaping (Int) -> UInt64 = AudioPlayer.defaultStreamRetryDelayNanoseconds) {
        self.streamRetryDelayNanoseconds = streamRetryDelayNanoseconds
        metadataPoller = MetadataPoller()
        configureAudioSession()
        wireAudioSessionNotifications()
        wireRemoteCommands()
    }

    func setListeningHistory(_ history: ListeningHistory) {
        listeningHistory = history
    }

    func setLockScreenSleepTimer(firesAt: Date?) {
        lockScreenSleepTimerFiresAt = firesAt
        scheduleLockScreenSleepTimerRefresh()
        if let lockScreenArtworkSourceImage {
            lockScreenArtwork = makeLockScreenArtwork(from: lockScreenArtworkSourceImage, sleepTimerActive: firesAt.map { $0 > Date() } == true)
        }
        updateNowPlaying()
    }

    func play(_ station: Station, queue: StationPlaybackQueue? = nil) {
        stopWakeKeepAlive()
        setActivePlaybackQueue(queue, for: station)
        diagnosticRecord("playback", "play requested", details: stationDiagnostics(station))
        // If we're already on this station, just unpause.
        if current?.id == station.id, let p = player {
            allowsAutomaticStreamRetry = true
            p.play()
            state = .playing
            diagnosticRecord("playback", "resumed current station", details: stationDiagnostics(station))
            listeningHistory?.resumeSession(for: station)
            updateRemoteStationCommandAvailability()
            updateNowPlaying()
            return
        }

        teardownPlayer()
        current = station
        state = .loading
        allowsAutomaticStreamRetry = true
        streamRetryAttempt = 0
        isStreamRetryScheduled = false
        nowPlayingTitle = nil
        nowPlayingArtist = nil
        nowPlayingProgramName = nil
        nowPlayingProgramSubtitle = nil
        nowPlayingCoverUrl = nil
        nowPlayingSchedule = []
        isScheduleLoading = false
        resetLyrics()

        let item = makePlayerItem(for: station)

        let p = AVPlayer(playerItem: item)
        p.automaticallyWaitsToMinimizeStalling = true
        observeStatus(p)
        player = p
        p.play()
        diagnosticRecord("playback", "avplayer started", details: stationDiagnostics(station))
        donatePlaybackActivity(for: station)
        listeningHistory?.startSession(for: station)
        startMetadataPolling(for: station)
        startScheduleLoading(for: station)
        updateRemoteStationCommandAvailability()
        updateNowPlaying()
    }

    func applyPrefetchedMetadata(_ metadata: NowPlayingMetadata, for station: Station) {
        guard current?.id == station.id else { return }
        diagnosticRecord("metadata", "prefetched metadata applied", details: metadataDiagnostics(metadata, station: station))
        nowPlayingArtist = metadata.artist
        nowPlayingTitle = metadata.title
        nowPlayingProgramName = metadata.programName
        nowPlayingProgramSubtitle = metadata.programSubtitle
        if let coverUrl = metadata.coverUrl {
            nowPlayingCoverUrl = coverUrl
        }
        startLyricsLoadingIfNeeded()
        startCoverArtLoadingIfNeeded(sourceCoverUrl: metadata.coverUrl)
        listeningHistory?.updateCurrentTrack(artist: metadata.artist, title: metadata.title)
        updateNowPlaying()
    }

    func pause() {
        allowsAutomaticStreamRetry = false
        streamRetryTask?.cancel()
        streamRetryTask = nil
        isStreamRetryScheduled = false
        player?.pause()
        if state == .playing || state == .loading { state = .paused }
        diagnosticRecord("playback", "paused", details: current.map(stationDiagnostics) ?? [:])
        listeningHistory?.closeActiveSession()
        updateNowPlaying()
    }

    func resume() {
        guard let p = player, current != nil else { return }
        allowsAutomaticStreamRetry = true
        p.play()
        state = .playing
        if let current {
            diagnosticRecord("playback", "resume requested", details: stationDiagnostics(current))
            listeningHistory?.resumeSession(for: current)
        }
        updateNowPlaying()
    }

    @discardableResult
    func reconnectCurrentAfterConnectivityRestored() -> Bool {
        guard shouldAutoResumeAfterConnectivityRestored, let station = current else {
            return false
        }
        diagnosticRecord("playback", "auto resume after network restored", details: stationDiagnostics(station))
        teardownPlayer()
        current = nil
        play(station)
        return true
    }

    func toggle() {
        switch state {
        case .playing:        pause()
        case .paused, .error: resume()
        case .idle, .loading: break
        }
    }

    func stop() {
        stopWakeKeepAlive()
        diagnosticRecord("playback", "stopped", details: current.map(stationDiagnostics) ?? [:])
        allowsAutomaticStreamRetry = false
        listeningHistory?.closeActiveSession()
        teardownPlayer()
        current = nil
        activePlaybackQueue = nil
        activePlaybackQueueSource = .single
        activePlaybackQueueSourceID = nil
        nowPlayingTitle = nil
        nowPlayingArtist = nil
        nowPlayingProgramName = nil
        nowPlayingProgramSubtitle = nil
        nowPlayingCoverUrl = nil
        nowPlayingSchedule = []
        isScheduleLoading = false
        resetLyrics()
        state = .idle
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        updateRemoteStationCommandAvailability()
    }

    @discardableResult
    func startWakeKeepAlive() -> Bool {
        guard wakeKeepAlivePlayer == nil else { return true }
        configureAudioSession()
        do {
            let player = try AVAudioPlayer(data: Self.keepAliveWavData())
            player.numberOfLoops = -1
            player.volume = 0.001
            player.prepareToPlay()
            guard player.play() else {
                diagnosticRecord("wake", "keep alive failed", details: ["error": "play returned false"])
                return false
            }
            wakeKeepAlivePlayer = player
            diagnosticRecord("wake", "keep alive started")
            return true
        } catch {
            diagnosticRecord("wake", "keep alive failed", details: ["error": error.localizedDescription])
            return false
        }
    }

    func stopWakeKeepAlive() {
        guard let wakeKeepAlivePlayer else { return }
        wakeKeepAlivePlayer.stop()
        self.wakeKeepAlivePlayer = nil
        diagnosticRecord("wake", "keep alive stopped")
    }

    // MARK: - Internals

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            diagnosticRecord("playback", "audio session configured")
        } catch {
            // Non-fatal — playback still works in foreground.
            diagnosticRecord("playback", "audio session failed", details: ["error": error.localizedDescription])
        }
    }

    nonisolated private static func defaultStreamRetryDelayNanoseconds(attempt: Int) -> UInt64 {
        let seconds = min(30, 1 << min(max(attempt - 1, 0), 5))
        return UInt64(seconds) * 1_000_000_000
    }

    private static func keepAliveWavData() -> Data {
        let sampleRate = 8_000
        let durationSeconds = 1
        let samples = sampleRate * durationSeconds
        let dataSize = samples * 2
        var data = Data()
        data.append(contentsOf: "RIFF".utf8)
        data.append(contentsOf: UInt32(36 + dataSize).littleEndianBytes)
        data.append(contentsOf: "WAVE".utf8)
        data.append(contentsOf: "fmt ".utf8)
        data.append(contentsOf: UInt32(16).littleEndianBytes)
        data.append(contentsOf: UInt16(1).littleEndianBytes)
        data.append(contentsOf: UInt16(1).littleEndianBytes)
        data.append(contentsOf: UInt32(sampleRate).littleEndianBytes)
        data.append(contentsOf: UInt32(sampleRate * 2).littleEndianBytes)
        data.append(contentsOf: UInt16(2).littleEndianBytes)
        data.append(contentsOf: UInt16(16).littleEndianBytes)
        data.append(contentsOf: "data".utf8)
        data.append(contentsOf: UInt32(dataSize).littleEndianBytes)
        data.append(Data(repeating: 0, count: dataSize))
        return data
    }

    private func donatePlaybackActivity(for station: Station) {
        let activity = NSUserActivity(activityType: "org.rrradio.playStation")
        activity.title = "Play \(station.name) in rrradio"
        activity.userInfo = ["stationID": station.id]
        activity.persistentIdentifier = "org.rrradio.playStation.\(station.id)"
        activity.isEligibleForSearch = true
        activity.isEligibleForPrediction = true
        activity.becomeCurrent()
        shortcutActivity = activity
    }

    private func setActivePlaybackQueue(_ queue: StationPlaybackQueue?, for station: Station) {
        if let queue {
            activePlaybackQueue = StationPlaybackQueue(
                source: queue.source,
                sourceID: queue.sourceID,
                stations: queue.stations,
                current: station,
            )
        } else if activePlaybackQueue?.contains(station) != true {
            activePlaybackQueue = StationPlaybackQueue(source: .single, stations: [station])
        }
        activePlaybackQueueSource = activePlaybackQueue?.source ?? .single
        activePlaybackQueueSourceID = activePlaybackQueue?.sourceID
    }

    private func wireRemoteCommands() {
        let cmd = MPRemoteCommandCenter.shared()
        // MPRemoteCommand handlers fire on the main thread (per Apple
        // docs), but the closure itself is non-isolated and our methods
        // are MainActor-only — hop explicitly so the contract is in code
        // rather than a runtime assumption.
        cmd.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }
            return .success
        }
        cmd.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        cmd.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
            return .success
        }
        cmd.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.playStationStep(.backward) }
            return .success
        }
        cmd.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.playStationStep(.forward) }
            return .success
        }
        // Live streams have no scrub / timed skip — disable those explicitly
        // so the lock-screen UI only exposes station changes.
        cmd.skipForwardCommand.isEnabled = false
        cmd.skipBackwardCommand.isEnabled = false
        cmd.changePlaybackPositionCommand.isEnabled = false
        updateRemoteStationCommandAvailability()
    }

    private func updateRemoteStationCommandAvailability() {
        let cmd = MPRemoteCommandCenter.shared()
        let canStepStations = current != nil && (activePlaybackQueue?.stations.count ?? 0) > 1
        cmd.previousTrackCommand.isEnabled = canStepStations
        cmd.nextTrackCommand.isEnabled = canStepStations
    }

    func stationForActivePlaybackStep(_ direction: StationStepDirection) -> Station? {
        activePlaybackQueue?.station(from: current, direction: direction)
    }

    private func playStationStep(_ direction: StationStepDirection) {
        guard let station = stationForActivePlaybackStep(direction) else {
            diagnosticRecord("playback", "remote station step unavailable", details: current.map(stationDiagnostics) ?? [:])
            return
        }

        let directionName = direction == .forward ? "forward" : "backward"
        diagnosticRecord(
            "playback",
            "remote station step",
            details: stationDiagnostics(station).merging(
                [
                    "direction": directionName,
                    "queueSource": activePlaybackQueue?.source.rawValue ?? "",
                ],
                uniquingKeysWith: { _, new in new },
            ),
        )

        guard station.id != current?.id else { return }
        play(station)
    }

    private func wireAudioSessionNotifications() {
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        audioSessionObservers.add(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session,
            queue: nil,
        ) { [weak self] notification in
            Task { @MainActor [weak self] in
                self?.handleAudioSessionInterruption(notification)
            }
        })

        audioSessionObservers.add(center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: session,
            queue: nil,
        ) { [weak self] notification in
            Task { @MainActor [weak self] in
                self?.handleAudioSessionRouteChange(notification)
            }
        })
    }

    private func handleAudioSessionInterruption(_ notification: Notification) {
        guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }

        switch type {
        case .began:
            shouldResumeAfterInterruption = state == .playing || state == .loading
            allowsAutomaticStreamRetry = false
            streamRetryTask?.cancel()
            streamRetryTask = nil
            isStreamRetryScheduled = false
            player?.pause()
            if state == .playing || state == .loading {
                state = .paused
            }
            do {
                try AVAudioSession.sharedInstance().setActive(false)
            } catch {
                diagnosticRecord("playback", "audio session deactivate failed", details: ["error": error.localizedDescription])
            }
            diagnosticRecord("playback", "audio interruption began", details: current.map(stationDiagnostics) ?? [:])
            updateNowPlaying()

        case .ended:
            do {
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                diagnosticRecord("playback", "audio session reactivate failed", details: ["error": error.localizedDescription])
            }

            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let options = AVAudioSession.InterruptionOptions(rawValue: rawOptions)
            let shouldResume = shouldResumeAfterInterruption && options.contains(.shouldResume)
            shouldResumeAfterInterruption = false
            diagnosticRecord("playback", "audio interruption ended", details: current.map(stationDiagnostics) ?? [:])
            if shouldResume {
                resume()
            } else {
                updateNowPlaying()
            }

        @unknown default:
            break
        }
    }

    private func handleAudioSessionRouteChange(_ notification: Notification) {
        guard let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason),
              reason == .oldDeviceUnavailable else { return }

        diagnosticRecord("playback", "audio route unavailable", details: current.map(stationDiagnostics) ?? [:])
        pause()
    }

    private func observeStatus(_ p: AVPlayer) {
        // KVO change blocks fire on whatever queue caused the property
        // change (often main, but not contractually). Hop to main before
        // touching @Observable state.
        statusObserver = p.observe(\.currentItem?.status, options: [.new]) { [weak self] player, _ in
            let status = player.currentItem?.status
            let errMsg = player.currentItem?.error?.localizedDescription
            let rate = player.rate
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch status {
                case .readyToPlay:
                    self.streamRetryAttempt = 0
                    self.isStreamRetryScheduled = false
                    self.state = (rate > 0) ? .playing : .paused
                    if let current = self.current {
                        diagnosticRecord("playback", "ready to play", details: self.stationDiagnostics(current))
                    }
                case .failed:
                    self.state = .error(errMsg ?? "playback failed")
                    diagnosticRecord(
                        "playback",
                        "item failed",
                        details: [
                            "station": self.current?.name ?? "",
                            "stationID": self.current?.id ?? "",
                            "streamHost": self.current?.streamUrl.host() ?? "",
                            "error": errMsg ?? "playback failed",
                        ],
                    )
                    self.handlePlayerItemPlaybackProblem(reason: "item failed", error: errMsg)
                default: break
                }
                self.updateNowPlaying()
            }
        }
        rateObserver = p.observe(\.rate, options: [.new]) { [weak self] player, _ in
            let rate = player.rate
            Task { @MainActor [weak self] in
                guard let self else { return }
                if rate > 0 {
                    self.state = .playing
                    if let current = self.current {
                        diagnosticRecord("playback", "rate playing", details: self.stationDiagnostics(current))
                    }
                } else if case .playing = self.state {
                    self.state = .paused
                    if let current = self.current {
                        diagnosticRecord("playback", "rate paused", details: self.stationDiagnostics(current))
                    }
                }
                self.updateNowPlaying()
            }
        }
    }

    private func makePlayerItem(for station: Station) -> AVPlayerItem {
        let item = AVPlayerItem(url: station.streamUrl)
        observeMetadata(on: item)
        observePlayerItemNotifications(on: item)
        return item
    }

    private func observePlayerItemNotifications(on item: AVPlayerItem) {
        let center = NotificationCenter.default
        playerItemObservers.add(center.addObserver(
            forName: AVPlayerItem.failedToPlayToEndTimeNotification,
            object: item,
            queue: nil,
        ) { [weak self] notification in
            let error = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
            Task { @MainActor [weak self] in
                self?.handlePlayerItemPlaybackProblem(reason: "item failed to play to end", error: error)
            }
        })
        playerItemObservers.add(center.addObserver(
            forName: AVPlayerItem.playbackStalledNotification,
            object: item,
            queue: nil,
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.handlePlayerItemPlaybackProblem(reason: "item stalled", error: nil)
            }
        })
    }

    func handlePlayerItemPlaybackProblem(reason: String, error: String?) {
        guard allowsAutomaticStreamRetry, current != nil else { return }
        scheduleStreamRetry(reason: reason, error: error)
    }

    private func scheduleStreamRetry(reason: String, error: String?) {
        guard !isStreamRetryScheduled, let station = current else { return }

        streamRetryAttempt += 1
        let attempt = streamRetryAttempt
        guard attempt <= Self.maxStreamRetryAttempts else {
            allowsAutomaticStreamRetry = false
            state = .error(error ?? "stream unavailable")
            diagnosticRecord(
                "playback",
                "stream retry exhausted",
                details: stationDiagnostics(station).merging(["reason": reason], uniquingKeysWith: { _, new in new }),
            )
            updateNowPlaying()
            return
        }

        isStreamRetryScheduled = true
        state = .loading
        updateNowPlaying()

        let stationID = station.id
        let delay = streamRetryDelayNanoseconds(attempt)
        var details = stationDiagnostics(station)
        details["reason"] = reason
        details["attempt"] = String(attempt)
        if let error {
            details["error"] = error
        }
        diagnosticRecord("playback", "stream retry scheduled", details: details)

        streamRetryTask?.cancel()
        streamRetryTask = Task { [weak self] in
            if delay > 0 {
                do {
                    try await Task.sleep(nanoseconds: delay)
                } catch {
                    return
                }
            }
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self, self.current?.id == stationID else { return }
                self.isStreamRetryScheduled = false
                self.rebuildCurrentStreamItem()
            }
        }
    }

    private func rebuildCurrentStreamItem() {
        guard let station = current else { return }
        diagnosticRecord("playback", "stream retry rebuilding item", details: stationDiagnostics(station))
        removePlayerItemObservers()
        let item = makePlayerItem(for: station)
        if let player {
            player.replaceCurrentItem(with: item)
            player.play()
        } else {
            let p = AVPlayer(playerItem: item)
            p.automaticallyWaitsToMinimizeStalling = true
            observeStatus(p)
            player = p
            p.play()
        }
        allowsAutomaticStreamRetry = true
        state = .loading
        updateNowPlaying()
    }

    /// AVPlayer publishes ICY-style metadata for HLS streams via
    /// `AVPlayerItemMetadataOutput`. For Icecast/Shoutcast we get
    /// nothing here — the broadcaster fetchers fill that in.
    private func observeMetadata(on item: AVPlayerItem) {
        let output = AVPlayerItemMetadataOutput(identifiers: nil)
        let delegate = TimedMetadataOutputDelegate { [weak self] metas in
            Task { @MainActor [weak self] in
                await self?.applyTimedMetadata(metas)
            }
        }
        output.setDelegate(delegate, queue: .main)
        item.add(output)
        metadataOutput = output
        metadataOutputDelegate = delegate
    }

    private func stationDiagnostics(_ station: Station) -> [String: String] {
        [
            "station": station.name,
            "stationID": station.id,
            "streamHost": station.streamUrl.host() ?? "",
            "codec": station.codec ?? "",
            "bitrate": station.bitrate.map(String.init) ?? "",
        ]
    }

    private func metadataDiagnostics(_ metadata: NowPlayingMetadata, station: Station) -> [String: String] {
        [
            "station": station.name,
            "hasArtist": String(metadata.artist?.isEmpty == false),
            "hasTitle": String(metadata.title?.isEmpty == false),
            "hasProgram": String(metadata.programName?.isEmpty == false),
            "coverHost": metadata.coverUrl?.host() ?? "",
        ]
    }

    private func applyTimedMetadata(_ metas: [AVMetadataItem]) async {
        // ICY title comes through with commonKey == .commonKeyTitle for
        // most HLS-wrapped Icecast feeds. Take the most recent string.
        for m in metas {
            guard let key = m.commonKey, key.rawValue == "title",
                  let v = try? await m.load(.stringValue), !v.isEmpty else { continue }
            // StreamTitle is usually "Artist - Title". Split once.
            if let dash = v.range(of: " - ") {
                nowPlayingArtist = String(v[..<dash.lowerBound])
                nowPlayingTitle = String(v[dash.upperBound...])
            } else {
                nowPlayingArtist = nil
                nowPlayingTitle = v
            }
            startLyricsLoadingIfNeeded()
            startCoverArtLoadingIfNeeded(sourceCoverUrl: nil)
            listeningHistory?.updateCurrentTrack(artist: nowPlayingArtist, title: nowPlayingTitle)
            if let current {
                diagnosticRecord(
                    "metadata",
                    "timed metadata received",
                    details: [
                        "station": current.name,
                        "hasArtist": String(nowPlayingArtist?.isEmpty == false),
                        "hasTitle": String(nowPlayingTitle?.isEmpty == false),
                    ],
                )
            }
            updateNowPlaying()
        }
    }

    private func startMetadataPolling(for station: Station) {
        guard let fetcher = metadataFetcher(for: station) else {
            diagnosticRecord("metadata", "no fetcher", details: stationDiagnostics(station))
            return
        }
        diagnosticRecord("metadata", "polling started", details: stationDiagnostics(station))
        metadataPoller?.start(station: station, fetcher: fetcher) { [weak self] metadata in
            guard let self, self.current?.id == station.id, let metadata else { return }
            diagnosticRecord("metadata", "polling received", details: self.metadataDiagnostics(metadata, station: station))
            self.nowPlayingArtist = metadata.artist
            self.nowPlayingTitle = metadata.title
            self.nowPlayingProgramName = metadata.programName
            self.nowPlayingProgramSubtitle = metadata.programSubtitle
            if let coverUrl = metadata.coverUrl {
                self.nowPlayingCoverUrl = coverUrl
            }
            self.startLyricsLoadingIfNeeded()
            self.startCoverArtLoadingIfNeeded(sourceCoverUrl: metadata.coverUrl)
            self.listeningHistory?.updateCurrentTrack(artist: metadata.artist, title: metadata.title)
            self.updateNowPlaying()
        }
    }

    private func startScheduleLoading(for station: Station) {
        scheduleTask?.cancel()
        nowPlayingSchedule = []
        guard let fetcher = scheduleFetcher(for: station) else {
            isScheduleLoading = false
            return
        }

        isScheduleLoading = true
        scheduleTask = Task { [weak self] in
            do {
                let days = try await fetcher(station) ?? []
                guard !Task.isCancelled else { return }
                await MainActor.run { [weak self] in
                    guard let self, self.current?.id == station.id else { return }
                    self.nowPlayingSchedule = days
                    self.isScheduleLoading = false
                    diagnosticRecord("schedule", "loaded", details: ["station": station.name, "days": String(days.count)])
                }
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run { [weak self] in
                    guard let self, self.current?.id == station.id else { return }
                    self.nowPlayingSchedule = []
                    self.isScheduleLoading = false
                    diagnosticRecord("schedule", "failed", details: ["station": station.name, "error": error.localizedDescription])
                }
            }
        }
    }

    private func updateNowPlaying() {
        guard let s = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = lockScreenTitle(for: s)
        info[MPMediaItemPropertyArtist] = lockScreenSubtitle(for: s)
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        info[MPNowPlayingInfoPropertyPlaybackRate] = (state == .playing) ? 1.0 : 0.0
        if let queueInfo = activePlaybackQueue?.queueInfo(for: s) {
            info[MPNowPlayingInfoPropertyPlaybackQueueIndex] = queueInfo.index
            info[MPNowPlayingInfoPropertyPlaybackQueueCount] = queueInfo.count
        }
        if let lockScreenArtwork {
            info[MPMediaItemPropertyArtwork] = lockScreenArtwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        updateLockScreenArtwork(from: nowPlayingCoverUrl ?? s.favicon)
    }

    private func teardownPlayer() {
        listeningHistory?.closeActiveSession()
        streamRetryTask?.cancel()
        streamRetryTask = nil
        streamRetryAttempt = 0
        isStreamRetryScheduled = false
        metadataPoller?.stop()
        scheduleTask?.cancel()
        scheduleTask = nil
        isScheduleLoading = false
        lyricsTask?.cancel()
        lyricsTask = nil
        isLyricsLoading = false
        coverArtTask?.cancel()
        coverArtTask = nil
        coverArtKey = ""
        lockScreenArtworkTask?.cancel()
        lockScreenArtworkTask = nil
        lockScreenArtworkURL = nil
        lockScreenArtworkSourceImage = nil
        lockScreenArtwork = nil
        lockScreenSleepTimerRefreshTimer?.invalidate()
        lockScreenSleepTimerRefreshTimer = nil
        removePlayerItemObservers()
        statusObserver?.invalidate()
        statusObserver = nil
        rateObserver?.invalidate()
        rateObserver = nil
        player?.pause()
        player = nil
    }

    private func removePlayerItemObservers() {
        if let metadataOutput, let currentItem = player?.currentItem {
            currentItem.remove(metadataOutput)
        }
        metadataOutput = nil
        metadataOutputDelegate = nil
        playerItemObservers.removeAll()
    }

    private func startLyricsLoadingIfNeeded() {
        guard let artist = cleanLyricsComponent(nowPlayingArtist),
              let title = cleanLyricsComponent(nowPlayingTitle) else {
            resetLyrics()
            return
        }

        let key = lyricsCacheKey(artist: artist, track: title)
        guard key != lyricsKey else { return }

        lyricsTask?.cancel()
        lyricsKey = key
        nowPlayingLyrics = nil
        isLyricsLoading = true

        lyricsTask = Task { [weak self] in
            let lyrics = await lookupLyrics(artist: artist, track: title)
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self, self.lyricsKey == key else { return }
                self.nowPlayingLyrics = lyrics
                self.isLyricsLoading = false
                diagnosticRecord("lyrics", lyrics == nil ? "not found" : "loaded")
            }
        }
    }

    private func resetLyrics() {
        lyricsTask?.cancel()
        lyricsTask = nil
        lyricsKey = ""
        nowPlayingLyrics = nil
        isLyricsLoading = false
    }

    private func startCoverArtLoadingIfNeeded(sourceCoverUrl: URL?) {
        guard sourceCoverUrl == nil || sourceCoverUrl.map(isLowResolutionCoverURL) == true else {
            resetCoverArtLookup()
            return
        }
        guard let title = cleanLyricsComponent(nowPlayingTitle) else {
            resetCoverArtLookup()
            return
        }

        let artist = cleanLyricsComponent(nowPlayingArtist)
        let key = "\((artist ?? "").lowercased())|\(title.lowercased())"
        guard key != coverArtKey else { return }

        coverArtTask?.cancel()
        coverArtKey = key
        coverArtTask = Task { [weak self] in
            let coverUrl = await lookupCoverArt(artist: artist, title: title)
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self, self.coverArtKey == key else { return }
                guard let coverUrl else {
                    diagnosticRecord("cover-art", "not found")
                    return
                }
                self.nowPlayingCoverUrl = coverUrl
                diagnosticRecord("cover-art", "loaded", details: ["host": coverUrl.host() ?? ""])
                self.updateNowPlaying()
            }
        }
    }

    private func resetCoverArtLookup() {
        coverArtTask?.cancel()
        coverArtTask = nil
        coverArtKey = ""
    }

    private func cleanLyricsComponent(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private func lockScreenTitle(for station: Station) -> String {
        let title: String
        if let program = cleanLyricsComponent(nowPlayingProgramName) {
            title = "\(station.name) - \(program)"
        } else {
            title = station.name
        }

        guard let sleepTimerText = lockScreenSleepTimerText() else { return title }
        return "\(title) - Sleep in \(sleepTimerText)"
    }

    private func lockScreenSubtitle(for station: Station) -> String {
        let subtitle: String
        if let title = cleanLyricsComponent(nowPlayingTitle) {
            if let artist = cleanLyricsComponent(nowPlayingArtist) {
                subtitle = "\(artist) - \(title)"
            } else {
                subtitle = title
            }
        } else {
            switch state {
            case .idle:
                subtitle = station.country?.uppercased() ?? "Standby"
            case .loading:
                subtitle = "Loading"
            case .playing:
                subtitle = "Live"
            case .paused:
                subtitle = "Paused"
            case .error:
                subtitle = "Error"
            }
        }

        return subtitle
    }

    private func lockScreenSleepTimerText(at date: Date = Date()) -> String? {
        guard let firesAt = lockScreenSleepTimerFiresAt else { return nil }
        let interval = firesAt.timeIntervalSince(date)
        guard interval > 0 else { return nil }
        let totalMinutes = max(1, Int(ceil(interval / 60)))
        return "\(totalMinutes)m"
    }

    private func scheduleLockScreenSleepTimerRefresh() {
        lockScreenSleepTimerRefreshTimer?.invalidate()
        lockScreenSleepTimerRefreshTimer = nil

        guard let firesAt = lockScreenSleepTimerFiresAt, firesAt > Date() else { return }
        lockScreenSleepTimerRefreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] timer in
            Task { @MainActor [weak self] in
                guard let self else {
                    timer.invalidate()
                    return
                }
                if let firesAt = self.lockScreenSleepTimerFiresAt, firesAt > Date() {
                    self.updateNowPlaying()
                } else {
                    timer.invalidate()
                    self.lockScreenSleepTimerRefreshTimer = nil
                    self.updateNowPlaying()
                }
            }
        }
    }

    private func updateLockScreenArtwork(from url: URL?) {
        guard lockScreenArtworkURL != url else { return }
        lockScreenArtworkTask?.cancel()
        lockScreenArtworkURL = url
        lockScreenArtworkSourceImage = nil
        lockScreenArtwork = nil

        guard let url else { return }

        lockScreenArtworkTask = Task { [weak self] in
            var request = URLRequest(url: url)
            request.timeoutInterval = Self.lockScreenArtworkTimeout
            guard let (data, response) = try? await URLSession.shared.data(for: request),
                  (response as? HTTPURLResponse).map({ (200...299).contains($0.statusCode) }) != false,
                  data.count <= Self.lockScreenArtworkMaximumBytes,
                  !Task.isCancelled,
                  let image = UIImage(data: data) else { return }

            let artwork = makeLockScreenArtwork(from: image, sleepTimerActive: self?.lockScreenSleepTimerFiresAt.map { $0 > Date() } == true)
            await MainActor.run { [weak self] in
                guard let self, self.lockScreenArtworkURL == url else { return }
                self.lockScreenArtworkSourceImage = image
                self.lockScreenArtwork = artwork
                self.updateNowPlaying()
            }
        }
    }
}

private func makeLockScreenArtwork(from image: UIImage, sleepTimerActive: Bool = false) -> MPMediaItemArtwork {
    let artworkSize = CGSize(width: 512, height: 512)
    return MPMediaItemArtwork(boundsSize: artworkSize) { requestedSize in
        renderLockScreenArtwork(image, requestedSize: requestedSize, sleepTimerActive: sleepTimerActive)
    }
}

private func renderLockScreenArtwork(_ image: UIImage, requestedSize: CGSize, sleepTimerActive: Bool) -> UIImage {
    let targetSize = normalizedArtworkSize(requestedSize)
    let sourceSize = normalizedArtworkSize(image.size)
    let fitScale = min(targetSize.width / sourceSize.width, targetSize.height / sourceSize.height)
    let drawScale = min(1, fitScale)
    let drawSize = CGSize(width: sourceSize.width * drawScale, height: sourceSize.height * drawScale)
    let drawOrigin = CGPoint(
        x: (targetSize.width - drawSize.width) / 2,
        y: (targetSize.height - drawSize.height) / 2
    )

    let format = UIGraphicsImageRendererFormat()
    format.scale = UIScreen.main.scale
    format.opaque = false

    return UIGraphicsImageRenderer(size: targetSize, format: format).image { context in
        image.draw(in: CGRect(origin: drawOrigin, size: drawSize))
        guard sleepTimerActive else { return }

        let badgeSize = min(targetSize.width, targetSize.height) * 0.23
        let badgePadding = badgeSize * 0.18
        let badgeRect = CGRect(
            x: targetSize.width - badgeSize - badgePadding,
            y: targetSize.height - badgeSize - badgePadding,
            width: badgeSize,
            height: badgeSize
        )
        let badgePath = UIBezierPath(ovalIn: badgeRect)
        UIColor(red: 1, green: 1, blue: 0, alpha: 0.94).setFill()
        badgePath.fill()

        UIColor(red: 0.145, green: 0.145, blue: 0.130, alpha: 0.72).setStroke()
        badgePath.lineWidth = max(2, badgeSize * 0.045)
        badgePath.stroke()

        let iconConfig = UIImage.SymbolConfiguration(pointSize: badgeSize * 0.43, weight: .semibold)
        guard let icon = UIImage(systemName: "moon.zzz.fill", withConfiguration: iconConfig)?
            .withTintColor(UIColor(red: 0.245, green: 0.245, blue: 0.225, alpha: 1), renderingMode: .alwaysOriginal) else { return }
        let iconSize = icon.size
        let iconRect = CGRect(
            x: badgeRect.midX - iconSize.width / 2,
            y: badgeRect.midY - iconSize.height / 2,
            width: iconSize.width,
            height: iconSize.height
        )
        icon.draw(in: iconRect)
        context.cgContext.setBlendMode(.normal)
    }
}

private func normalizedArtworkSize(_ size: CGSize) -> CGSize {
    CGSize(width: max(size.width, 1), height: max(size.height, 1))
}

private final class NotificationObserverStore {
    private var observers: [NSObjectProtocol] = []

    func add(_ observer: NSObjectProtocol) {
        observers.append(observer)
    }

    func removeAll() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
    }

    deinit {
        removeAll()
    }
}

private final class TimedMetadataOutputDelegate: NSObject, AVPlayerItemMetadataOutputPushDelegate {
    private let onMetadata: ([AVMetadataItem]) -> Void

    init(onMetadata: @escaping ([AVMetadataItem]) -> Void) {
        self.onMetadata = onMetadata
    }

    func metadataOutput(
        _ output: AVPlayerItemMetadataOutput,
        didOutputTimedMetadataGroups groups: [AVTimedMetadataGroup],
        from track: AVPlayerItemTrack?,
    ) {
        onMetadata(groups.flatMap(\.items))
    }
}
