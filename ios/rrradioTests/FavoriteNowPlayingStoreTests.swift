import XCTest
@testable import rrradio

final class FavoriteNowPlayingStoreTests: XCTestCase {
    private func station(status: String? = "stream-only") -> Station {
        Station(
            id: "test",
            name: "Test FM",
            streamUrl: URL(string: "https://example.com/stream")!,
            status: status,
        )
    }

    func testSkipsIcyFallbackForNonIcyStations() async throws {
        var icyCalled = false

        let metadata = try await FavoriteNowPlayingStore.metadata(
            for: station(status: "stream-only"),
            fetcher: { _ in nil },
            icyFetch: { _ in
                icyCalled = true
                return NowPlayingMetadata(artist: "Icy", title: "Track", raw: "Icy - Track")
            },
        )

        XCTAssertNil(metadata)
        XCTAssertFalse(icyCalled)
    }

    func testUsesIcyFallbackForIcyOnlyStations() async throws {
        var icyCalled = false

        let metadata = try await FavoriteNowPlayingStore.metadata(
            for: station(status: "icy-only"),
            fetcher: { _ in nil },
            icyFetch: { _ in
                icyCalled = true
                return NowPlayingMetadata(artist: "Icy", title: "Track", raw: "Icy - Track")
            },
        )

        XCTAssertTrue(icyCalled)
        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Icy", title: "Track", raw: "Icy - Track"))
    }

    func testDirectFetcherWinsBeforeIcyFallback() async throws {
        var icyCalled = false

        let metadata = try await FavoriteNowPlayingStore.metadata(
            for: station(status: "icy-only"),
            fetcher: { _ in NowPlayingMetadata(artist: "Direct", title: "Track", raw: "Direct - Track") },
            icyFetch: { _ in
                icyCalled = true
                return NowPlayingMetadata(artist: "Icy", title: "Track", raw: "Icy - Track")
            },
        )

        XCTAssertFalse(icyCalled)
        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Direct", title: "Track", raw: "Direct - Track"))
    }
}
