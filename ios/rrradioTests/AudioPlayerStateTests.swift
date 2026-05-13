import AVFoundation
import XCTest
@testable import rrradio

/// AudioPlayer state contract — what the public API guarantees without
/// touching real audio hardware. Audit #72.
///
/// What we deliberately don't test here: AVPlayer's actual playback
/// (no audio device on CI), KVO transitions on real streams, lock-screen
/// MPNowPlayingInfo (singleton, hard to isolate). Those need a UI test
/// or device-attached integration test — out of scope for this baseline.
@MainActor
final class AudioPlayerStateTests: XCTestCase {
    private func station(id: String = "test", name: String = "Test FM") -> Station {
        Station(
            id: id,
            name: name,
            streamUrl: URL(string: "https://example.com/stream")!,
        )
    }

    private func yieldNotificationTasks() async {
        await Task.yield()
        await Task.yield()
    }

    func testStartsIdle() {
        let p = AudioPlayer()
        XCTAssertEqual(p.state, .idle)
        XCTAssertNil(p.current)
        XCTAssertNil(p.nowPlayingTitle)
        XCTAssertNil(p.nowPlayingArtist)
    }

    func testToggleFromIdleIsNoOp() {
        let p = AudioPlayer()
        p.toggle()
        XCTAssertEqual(p.state, .idle)
        XCTAssertNil(p.current)
    }

    func testPauseFromIdleStaysIdle() {
        let p = AudioPlayer()
        p.pause()
        XCTAssertEqual(p.state, .idle)
    }

    func testResumeWithoutCurrentIsNoOp() {
        let p = AudioPlayer()
        p.resume()
        XCTAssertEqual(p.state, .idle)
        XCTAssertNil(p.current)
    }

    func testStopClearsCurrent() {
        let p = AudioPlayer()
        // Start a "play" — it will go to .loading because the URL won't
        // actually resolve fast enough on a unit-test runtime.
        p.play(station())
        XCTAssertEqual(p.current?.id, "test")
        p.stop()
        XCTAssertEqual(p.state, .idle)
        XCTAssertNil(p.current)
        XCTAssertNil(p.nowPlayingTitle)
    }

    func testPlayLoadsStation() {
        let p = AudioPlayer()
        p.play(station(id: "abc", name: "ABC FM"))
        XCTAssertEqual(p.current?.id, "abc")
        XCTAssertEqual(p.state, .loading)
    }

    func testAutoResumeRequiresActiveStation() {
        let p = AudioPlayer()
        XCTAssertFalse(p.shouldAutoResumeAfterConnectivityRestored)

        p.play(station(id: "abc", name: "ABC FM"))

        XCTAssertTrue(p.shouldAutoResumeAfterConnectivityRestored)
    }

    func testPlaybackQueueCyclesThroughBrowseSnapshot() {
        let a = station(id: "a")
        let b = station(id: "b")
        let c = station(id: "c")
        let queue = StationPlaybackQueue(source: .browse, stations: [a, b, c], current: b)

        XCTAssertEqual(queue.station(from: b, direction: .forward)?.id, "c")
        XCTAssertEqual(queue.station(from: b, direction: .backward)?.id, "a")
        XCTAssertEqual(queue.station(from: c, direction: .forward)?.id, "a")
    }

    func testPlaybackQueueKeepsCurrentStationWhenItIsOutsideTheList() {
        let a = station(id: "a")
        let b = station(id: "b")
        let x = station(id: "x")
        let queue = StationPlaybackQueue(source: .favorites, stations: [a, b], current: x)

        XCTAssertEqual(queue.stations.map(\.id), ["x", "a", "b"])
        XCTAssertEqual(queue.station(from: x, direction: .forward)?.id, "a")
        XCTAssertEqual(queue.station(from: x, direction: .backward)?.id, "b")
    }

    func testPlayingStationWithQueueStoresActivePlaybackQueue() {
        let p = AudioPlayer()
        let a = station(id: "a")
        let b = station(id: "b")
        let c = station(id: "c")

        p.play(b, queue: StationPlaybackQueue(source: .browse, stations: [a, b, c]))

        XCTAssertEqual(p.activePlaybackQueue?.source, .browse)
        XCTAssertEqual(p.activePlaybackQueue?.stations.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(p.stationForActivePlaybackStep(.forward)?.id, "c")
        XCTAssertEqual(p.stationForActivePlaybackStep(.backward)?.id, "a")
        p.stop()
    }

    func testPlayingNextQueuedStationWithoutNewQueuePreservesActiveQueue() {
        let p = AudioPlayer()
        let a = station(id: "a")
        let b = station(id: "b")
        let c = station(id: "c")

        p.play(b, queue: StationPlaybackQueue(source: .favorites, stations: [a, b, c]))
        p.play(c)

        XCTAssertEqual(p.activePlaybackQueue?.source, .favorites)
        XCTAssertEqual(p.activePlaybackQueue?.stations.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(p.stationForActivePlaybackStep(.forward)?.id, "a")
        p.stop()
    }

    func testInterruptionPausesAndResumesWhenSystemAllows() async {
        let p = AudioPlayer(streamRetryDelayNanoseconds: { _ in 0 })
        p.play(station(id: "abc", name: "ABC FM"))
        p.resume()
        XCTAssertEqual(p.state, .playing)

        NotificationCenter.default.post(
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue],
        )
        await yieldNotificationTasks()

        XCTAssertEqual(p.state, .paused)

        NotificationCenter.default.post(
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            userInfo: [
                AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
                AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue,
            ],
        )
        await yieldNotificationTasks()

        XCTAssertEqual(p.state, .playing)
    }

    func testOldAudioRouteUnavailablePausesPlayback() async {
        let p = AudioPlayer(streamRetryDelayNanoseconds: { _ in 0 })
        p.play(station(id: "abc", name: "ABC FM"))
        p.resume()
        XCTAssertEqual(p.state, .playing)

        NotificationCenter.default.post(
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue],
        )
        await yieldNotificationTasks()

        XCTAssertEqual(p.state, .paused)
    }

    func testPlaybackProblemSchedulesRetryForCurrentStation() {
        let p = AudioPlayer(streamRetryDelayNanoseconds: { _ in 0 })
        p.play(station(id: "abc", name: "ABC FM"))
        p.resume()

        p.handlePlayerItemPlaybackProblem(reason: "test", error: nil)

        XCTAssertEqual(p.current?.id, "abc")
        XCTAssertEqual(p.state, .loading)
        p.stop()
    }

    func testStateEnumEquality() {
        XCTAssertEqual(AudioPlayer.State.idle, AudioPlayer.State.idle)
        XCTAssertEqual(AudioPlayer.State.error("net"), AudioPlayer.State.error("net"))
        XCTAssertNotEqual(AudioPlayer.State.error("net"), AudioPlayer.State.error("other"))
        XCTAssertNotEqual(AudioPlayer.State.idle, AudioPlayer.State.loading)
    }
}
