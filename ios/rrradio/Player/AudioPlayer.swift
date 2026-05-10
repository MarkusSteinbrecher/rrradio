import AVFoundation
import MediaPlayer
import Observation
import UIKit

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
    private var metadataPoller: MetadataPoller?
    private var scheduleTask: Task<Void, Never>?
    private var lyricsTask: Task<Void, Never>?
    private var coverArtTask: Task<Void, Never>?
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

    init() {
        metadataPoller = MetadataPoller()
        configureAudioSession()
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

    func play(_ station: Station) {
        stopWakeKeepAlive()
        diagnosticRecord("playback", "play requested", details: stationDiagnostics(station))
        // If we're already on this station, just unpause.
        if current?.id == station.id, let p = player {
            p.play()
            state = .playing
            diagnosticRecord("playback", "resumed current station", details: stationDiagnostics(station))
            listeningHistory?.resumeSession(for: station)
            updateNowPlaying()
            return
        }

        teardownPlayer()
        current = station
        state = .loading
        nowPlayingTitle = nil
        nowPlayingArtist = nil
        nowPlayingProgramName = nil
        nowPlayingProgramSubtitle = nil
        nowPlayingCoverUrl = nil
        nowPlayingSchedule = []
        isScheduleLoading = false
        resetLyrics()

        let item = AVPlayerItem(url: station.streamUrl)
        observeMetadata(on: item)

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
        player?.pause()
        if state == .playing { state = .paused }
        diagnosticRecord("playback", "paused", details: current.map(stationDiagnostics) ?? [:])
        listeningHistory?.closeActiveSession()
        updateNowPlaying()
    }

    func resume() {
        guard let p = player, current != nil else { return }
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
        listeningHistory?.closeActiveSession()
        teardownPlayer()
        current = nil
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
        // Live streams have no scrub / skip — disable those explicitly
        // so the lock-screen UI hides them.
        cmd.skipForwardCommand.isEnabled = false
        cmd.skipBackwardCommand.isEnabled = false
        cmd.changePlaybackPositionCommand.isEnabled = false
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
        if let lockScreenArtwork {
            info[MPMediaItemPropertyArtwork] = lockScreenArtwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        updateLockScreenArtwork(from: nowPlayingCoverUrl ?? s.favicon)
    }

    private func teardownPlayer() {
        listeningHistory?.closeActiveSession()
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
        if let metadataOutput, let currentItem = player?.currentItem {
            currentItem.remove(metadataOutput)
        }
        metadataOutput = nil
        metadataOutputDelegate = nil
        statusObserver?.invalidate()
        statusObserver = nil
        rateObserver?.invalidate()
        rateObserver = nil
        player?.pause()
        player = nil
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
            guard let (data, _) = try? await URLSession.shared.data(from: url),
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
