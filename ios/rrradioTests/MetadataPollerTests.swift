import XCTest
@testable import rrradio

@MainActor
final class MetadataPollerTests: XCTestCase {
    private func station() -> Station {
        Station(
            id: "test",
            name: "Test FM",
            streamUrl: URL(string: "https://example.com/stream")!,
        )
    }

    func testContinuesAfterTransientFetcherError() async {
        let poller = MetadataPoller()
        var attempts = 0
        let recovered = expectation(description: "poller recovered")

        poller.start(
            station: station(),
            fetcher: { _ in
                let attempt = await MainActor.run {
                    attempts += 1
                    return attempts
                }
                if attempt == 1 {
                    throw URLError(.timedOut)
                }
                return NowPlayingMetadata(artist: "Artist", title: "Recovered", raw: "Artist - Recovered")
            },
            interval: 0.01,
        ) { metadata in
            if metadata?.title == "Recovered" {
                recovered.fulfill()
            }
        }

        await fulfillment(of: [recovered], timeout: 1)
        poller.stop()
        XCTAssertGreaterThanOrEqual(attempts, 2)
    }
}
