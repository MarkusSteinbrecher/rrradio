import XCTest
@testable import rrradio

final class FavoriteNowPlayingStoreTests: XCTestCase {
    private func station(
        status: String? = "stream-only",
        streamURL: String = "https://example.com/stream",
    ) -> Station {
        Station(
            id: "test",
            name: "Test FM",
            streamUrl: URL(string: streamURL)!,
            status: status,
        )
    }

    func testSkipsStreamFallbacksForNonIcyNonHlsStations() async throws {
        var icyCalled = false
        var hlsCalled = false

        let metadata = try await FavoriteNowPlayingStore.metadata(
            for: station(status: "stream-only"),
            fetcher: { _ in nil },
            icyFetch: { _ in
                icyCalled = true
                return NowPlayingMetadata(artist: "Icy", title: "Track", raw: "Icy - Track")
            },
            hlsFetch: { _ in
                hlsCalled = true
                return NowPlayingMetadata(artist: "HLS", title: "Track", raw: "HLS - Track")
            },
        )

        XCTAssertNil(metadata)
        XCTAssertFalse(icyCalled)
        XCTAssertFalse(hlsCalled)
    }

    func testUsesHlsFallbackForStreamOnlyHlsStations() async throws {
        var icyCalled = false
        var hlsCalled = false

        let metadata = try await FavoriteNowPlayingStore.metadata(
            for: station(status: "stream-only", streamURL: "https://example.com/live/chunks.m3u8"),
            fetcher: { _ in nil },
            icyFetch: { _ in
                icyCalled = true
                return NowPlayingMetadata(artist: "Icy", title: "Track", raw: "Icy - Track")
            },
            hlsFetch: { _ in
                hlsCalled = true
                return NowPlayingMetadata(artist: "HLS", title: "Track", raw: "HLS - Track")
            },
        )

        XCTAssertFalse(icyCalled)
        XCTAssertTrue(hlsCalled)
        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "HLS", title: "Track", raw: "HLS - Track"))
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
