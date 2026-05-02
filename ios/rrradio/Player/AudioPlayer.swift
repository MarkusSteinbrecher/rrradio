import AVFoundation
import Combine
import MediaPlayer
import Observation

/// Thin wrapper around AVPlayer with the iOS bits the web app handles
/// via the Media Session API: lock-screen now-playing card, remote
/// commands (play / pause / from AirPods), and audio-session
/// configuration so playback continues in the background.
///
/// v1 surfaces only what AVPlayer publishes for free:
///   - HLS streams: artist + title via AVPlayerItem.timedMetadata
///   - Icecast streams: nothing (no built-in ICY-over-fetch on iOS).
///     Phase-2 follow-up: port the Worker-proxied broadcaster fetchers
///     (BR / HR / Antenne / SRG SSR / etc.) from src/builtins.ts to
///     Swift and poll them like the web does.
@Observable
final class AudioPlayer {
    enum State: Equatable { case idle, loading, playing, paused, error(String) }

    private(set) var state: State = .idle
    private(set) var current: Station?
    private(set) var nowPlayingTitle: String?
    private(set) var nowPlayingArtist: String?

    private var player: AVPlayer?
    private var timedMetaObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var rateObserver: NSKeyValueObservation?

    init() {
        configureAudioSession()
        wireRemoteCommands()
    }

    func play(_ station: Station) {
        // If we're already on this station, just unpause.
        if current?.id == station.id, let p = player {
            p.play()
            state = .playing
            updateNowPlaying()
            return
        }

        teardownPlayer()
        current = station
        state = .loading
        nowPlayingTitle = nil
        nowPlayingArtist = nil

        let item = AVPlayerItem(url: station.streamUrl)
        observeMetadata(on: item)

        let p = AVPlayer(playerItem: item)
        p.automaticallyWaitsToMinimizeStalling = true
        observeStatus(p)
        player = p
        p.play()
        updateNowPlaying()
    }

    func pause() {
        player?.pause()
        if state == .playing { state = .paused }
        updateNowPlaying()
    }

    func resume() {
        guard let p = player, current != nil else { return }
        p.play()
        state = .playing
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
        teardownPlayer()
        current = nil
        nowPlayingTitle = nil
        nowPlayingArtist = nil
        state = .idle
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Internals

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
        } catch {
            // Non-fatal — playback still works in foreground.
        }
    }

    private func wireRemoteCommands() {
        let cmd = MPRemoteCommandCenter.shared()
        cmd.playCommand.addTarget { [weak self] _ in
            self?.resume()
            return .success
        }
        cmd.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }
        cmd.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.toggle()
            return .success
        }
        // Live streams have no scrub / skip — disable those explicitly
        // so the lock-screen UI hides them.
        cmd.skipForwardCommand.isEnabled = false
        cmd.skipBackwardCommand.isEnabled = false
        cmd.changePlaybackPositionCommand.isEnabled = false
    }

    private func observeStatus(_ p: AVPlayer) {
        statusObserver = p.observe(\.currentItem?.status, options: [.new]) { [weak self] player, _ in
            guard let self else { return }
            switch player.currentItem?.status {
            case .readyToPlay:
                if player.rate > 0 { self.state = .playing } else { self.state = .paused }
            case .failed:
                let msg = player.currentItem?.error?.localizedDescription ?? "playback failed"
                self.state = .error(msg)
            default: break
            }
            self.updateNowPlaying()
        }
        rateObserver = p.observe(\.rate, options: [.new]) { [weak self] player, _ in
            guard let self else { return }
            if player.rate > 0 { self.state = .playing }
            else if case .playing = self.state { self.state = .paused }
            self.updateNowPlaying()
        }
    }

    /// AVPlayer publishes ICY-style metadata for HLS streams via
    /// `timedMetadata`. For Icecast/Shoutcast we get nothing here —
    /// the Phase-2 broadcaster fetchers will fill that in.
    private func observeMetadata(on item: AVPlayerItem) {
        timedMetaObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemNewAccessLogEntry, object: item, queue: .main
        ) { _ in /* placeholder — kept for future ICY parsing */ }

        // Use the modern AVMetadataItem KVO path for now-playing changes.
        item.publisher(for: \.timedMetadata)
            .compactMap { $0 }
            .sink { [weak self] (metas: [AVMetadataItem]) in
                self?.applyTimedMetadata(metas)
            }
            .store(in: &cancellables)
    }

    private var cancellables = Set<AnyCancellable>()

    private func applyTimedMetadata(_ metas: [AVMetadataItem]) {
        // ICY title comes through with commonKey == .commonKeyTitle for
        // most HLS-wrapped Icecast feeds. Take the most recent string.
        for m in metas {
            guard let key = m.commonKey, key.rawValue == "title",
                  let v = m.stringValue, !v.isEmpty else { continue }
            // StreamTitle is usually "Artist - Title". Split once.
            if let dash = v.range(of: " - ") {
                nowPlayingArtist = String(v[..<dash.lowerBound])
                nowPlayingTitle = String(v[dash.upperBound...])
            } else {
                nowPlayingArtist = nil
                nowPlayingTitle = v
            }
            updateNowPlaying()
        }
    }

    private func updateNowPlaying() {
        guard let s = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = nowPlayingTitle ?? s.name
        info[MPMediaItemPropertyArtist] = nowPlayingArtist ?? s.country?.uppercased() ?? ""
        info[MPNowPlayingInfoPropertyIsLiveStream] = true
        info[MPNowPlayingInfoPropertyPlaybackRate] = (state == .playing) ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func teardownPlayer() {
        timedMetaObserver.map(NotificationCenter.default.removeObserver)
        timedMetaObserver = nil
        statusObserver?.invalidate()
        statusObserver = nil
        rateObserver?.invalidate()
        rateObserver = nil
        cancellables.removeAll()
        player?.pause()
        player = nil
    }
}

