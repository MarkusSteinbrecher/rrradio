import AVFoundation
import MediaPlayer
import Observation
import UIKit

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
    private var lockScreenArtwork: MPMediaItemArtwork?
    private var shortcutActivity: NSUserActivity?
    private weak var listeningHistory: ListeningHistory?
    private var lyricsKey = ""

    init() {
        metadataPoller = MetadataPoller()
        configureAudioSession()
        wireRemoteCommands()
    }

    func setListeningHistory(_ history: ListeningHistory) {
        listeningHistory = history
    }

    func play(_ station: Station) {
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

    func toggle() {
        switch state {
        case .playing:        pause()
        case .paused, .error: resume()
        case .idle, .loading: break
        }
    }

    func stop() {
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
            "artist": metadata.artist ?? "",
            "title": metadata.title ?? "",
            "program": metadata.programName ?? "",
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
                        "artist": nowPlayingArtist ?? "",
                        "title": nowPlayingTitle ?? "",
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
        lockScreenArtwork = nil
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
                diagnosticRecord("lyrics", lyrics == nil ? "not found" : "loaded", details: ["artist": artist, "title": title])
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
                    diagnosticRecord("cover-art", "not found", details: ["artist": artist ?? "", "title": title])
                    return
                }
                self.nowPlayingCoverUrl = coverUrl
                diagnosticRecord("cover-art", "loaded", details: ["artist": artist ?? "", "title": title, "host": coverUrl.host() ?? ""])
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
        guard let program = cleanLyricsComponent(nowPlayingProgramName) else {
            return station.name
        }
        return "\(station.name) - \(program)"
    }

    private func lockScreenSubtitle(for station: Station) -> String {
        if let title = cleanLyricsComponent(nowPlayingTitle) {
            if let artist = cleanLyricsComponent(nowPlayingArtist) {
                return "\(artist) - \(title)"
            }
            return title
        }

        switch state {
        case .idle:
            return station.country?.uppercased() ?? "Standby"
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

    private func updateLockScreenArtwork(from url: URL?) {
        guard lockScreenArtworkURL != url else { return }
        lockScreenArtworkTask?.cancel()
        lockScreenArtworkURL = url
        lockScreenArtwork = nil

        guard let url else { return }

        lockScreenArtworkTask = Task { [weak self] in
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                  !Task.isCancelled,
                  let image = UIImage(data: data) else { return }

            let artwork = makeLockScreenArtwork(from: image)
            await MainActor.run { [weak self] in
                guard let self, self.lockScreenArtworkURL == url else { return }
                self.lockScreenArtwork = artwork
                self.updateNowPlaying()
            }
        }
    }
}

private func makeLockScreenArtwork(from image: UIImage) -> MPMediaItemArtwork {
    let artworkSize = CGSize(width: 512, height: 512)
    return MPMediaItemArtwork(boundsSize: artworkSize) { requestedSize in
        renderLockScreenArtwork(image, requestedSize: requestedSize)
    }
}

private func renderLockScreenArtwork(_ image: UIImage, requestedSize: CGSize) -> UIImage {
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

    return UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
        image.draw(in: CGRect(origin: drawOrigin, size: drawSize))
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
