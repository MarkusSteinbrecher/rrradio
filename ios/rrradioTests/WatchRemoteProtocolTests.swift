import XCTest
@testable import rrradio

final class WatchRemoteProtocolTests: XCTestCase {
    func testCommandMessageRoundTrips() throws {
        let command = WatchPlaybackCommandEnvelope(
            kind: .playStation,
            stationID: "fm4",
            requestedAt: Date(timeIntervalSince1970: 1_700_000_000),
        )

        let message = try WatchRemoteMessageCodec.message(for: command)
        let decoded = try XCTUnwrap(try WatchRemoteMessageCodec.command(from: message))

        XCTAssertEqual(decoded.kind, .playStation)
        XCTAssertEqual(decoded.stationID, "fm4")
        XCTAssertEqual(decoded.requestedAt, command.requestedAt)
    }

    func testSnapshotMessageRoundTrips() throws {
        let snapshot = WatchPlaybackSnapshot(
            playbackState: .playing,
            currentStation: WatchStationSummary(
                id: "fm4",
                name: "FM4",
                broadcaster: "ORF",
                country: "AT",
                favicon: URL(string: "https://example.com/fm4.png"),
            ),
            nowPlayingTitle: "Song",
            nowPlayingArtist: "Artist",
            nowPlayingProgramName: "Program",
            nowPlayingCoverURL: URL(string: "https://example.com/cover.jpg"),
            favorites: [
                WatchStationSummary(
                    id: "fm4",
                    name: "FM4",
                    broadcaster: "ORF",
                    country: "AT",
                    favicon: nil,
                ),
            ],
            catalogStationCount: 42,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_001),
        )

        let message = try WatchRemoteMessageCodec.message(for: snapshot)
        let decoded = try XCTUnwrap(try WatchRemoteMessageCodec.snapshot(from: message))

        XCTAssertEqual(decoded, snapshot)
    }
}
