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

    func testStateEnumEquality() {
        XCTAssertEqual(AudioPlayer.State.idle, AudioPlayer.State.idle)
        XCTAssertEqual(AudioPlayer.State.error("net"), AudioPlayer.State.error("net"))
        XCTAssertNotEqual(AudioPlayer.State.error("net"), AudioPlayer.State.error("other"))
        XCTAssertNotEqual(AudioPlayer.State.idle, AudioPlayer.State.loading)
    }
}
