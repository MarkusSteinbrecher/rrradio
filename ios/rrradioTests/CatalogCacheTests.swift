import XCTest
@testable import rrradio

/// Catalog state contract + URL-session/cache fallback paths.
/// Audit #72 (initial); audit #72 follow-up adds full DI coverage.
@MainActor
final class CatalogCacheTests: XCTestCase {
    private func tmpCacheURL() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(
            "rrradio-catalog-test-\(UUID().uuidString).json",
        )
    }

    private let sample = """
    {
      "stations": [
        { "id": "a", "name": "A", "streamUrl": "https://x/a" },
        { "id": "b", "name": "B", "streamUrl": "https://x/b", "featured": true }
      ]
    }
    """.data(using: .utf8)!

    private func makeResponse(status: Int) -> HTTPURLResponse {
        HTTPURLResponse(
            url: Catalog.canonicalURL,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: nil,
        )!
    }

    // MARK: - Initial state

    func testStartsIdleWithEmptyStations() {
        let c = Catalog(cacheURL: tmpCacheURL())
        XCTAssertEqual(c.state, .idle)
        XCTAssertTrue(c.stations.isEmpty)
        XCTAssertTrue(c.browseOrdered.isEmpty)
    }

    func testCanonicalURLPointsAtRrradioOrg() {
        XCTAssertEqual(Catalog.canonicalURL.host, "rrradio.org")
        XCTAssertEqual(Catalog.canonicalURL.scheme, "https")
        XCTAssertEqual(Catalog.canonicalURL.path, "/stations.json")
    }

    // MARK: - Network success

    func testLoadIfNeededFetchesAndDecodes() async {
        let cacheURL = tmpCacheURL()
        let c = Catalog(
            fetch: { _ in (self.sample, self.makeResponse(status: 200)) },
            cacheURL: cacheURL,
        )
        await c.loadIfNeeded()
        XCTAssertEqual(c.state, .loaded)
        XCTAssertEqual(c.stations.map(\.id), ["a", "b"])
    }

    func testLoadWritesToCacheOnSuccess() async {
        let cacheURL = tmpCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL) }
        let c = Catalog(
            fetch: { _ in (self.sample, self.makeResponse(status: 200)) },
            cacheURL: cacheURL,
        )
        await c.loadIfNeeded()
        XCTAssertTrue(FileManager.default.fileExists(atPath: cacheURL.path))
    }

    func testBrowseOrderedFloatsFeaturedToTheTop() async {
        let c = Catalog(
            fetch: { _ in (self.sample, self.makeResponse(status: 200)) },
            cacheURL: self.tmpCacheURL(),
        )
        await c.loadIfNeeded()
        // Sample has b featured, a not — b should appear first.
        XCTAssertEqual(c.browseOrdered.map(\.id), ["b", "a"])
    }

    func testLoadIfNeededIsIdempotent() async {
        var calls = 0
        let c = Catalog(
            fetch: { _ in
                calls += 1
                return (self.sample, self.makeResponse(status: 200))
            },
            cacheURL: tmpCacheURL(),
        )
        await c.loadIfNeeded()
        await c.loadIfNeeded()
        XCTAssertEqual(calls, 1, "loadIfNeeded should fetch only once per session")
    }

    // MARK: - Network failure → cache fallback

    func testFallsBackToDiskCacheWhenNetworkFails() async {
        let cacheURL = tmpCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL) }
        // Pre-populate the cache.
        try? sample.write(to: cacheURL, options: .atomic)

        let c = Catalog(
            fetch: { _ in throw URLError(.notConnectedToInternet) },
            cacheURL: cacheURL,
        )
        await c.loadIfNeeded()
        XCTAssertEqual(c.state, .loaded, "should land at .loaded with cached rows even on net failure")
        XCTAssertEqual(c.stations.map(\.id), ["a", "b"])
    }

    func testFailsWhenNetworkErrorAndNoCache() async {
        let c = Catalog(
            fetch: { _ in throw URLError(.notConnectedToInternet) },
            cacheURL: tmpCacheURL(),
        )
        await c.loadIfNeeded()
        if case .failed = c.state {
            // expected
        } else {
            XCTFail("expected .failed when no cache + no network, got \(c.state)")
        }
        XCTAssertTrue(c.stations.isEmpty)
    }

    func testNon200ResponseFallsBackOrFails() async {
        let c = Catalog(
            fetch: { _ in (Data(), self.makeResponse(status: 503)) },
            cacheURL: tmpCacheURL(),
        )
        await c.loadIfNeeded()
        if case .failed = c.state {
            // expected — no cache and bad upstream → .failed
        } else {
            XCTFail("expected .failed on 503 with no cache, got \(c.state)")
        }
    }

    // MARK: - Cache shape

    func testReadsExistingCacheBeforeNetworkResolves() async {
        // Pre-populate cache with two stations.
        let cacheURL = tmpCacheURL()
        defer { try? FileManager.default.removeItem(at: cacheURL) }
        try? sample.write(to: cacheURL, options: .atomic)

        // Network returns a different shape (3 stations).
        let bigger = """
        {
          "stations": [
            { "id": "a", "name": "A", "streamUrl": "https://x/a" },
            { "id": "b", "name": "B", "streamUrl": "https://x/b" },
            { "id": "c", "name": "C", "streamUrl": "https://x/c" }
          ]
        }
        """.data(using: .utf8)!

        let c = Catalog(
            fetch: { _ in (bigger, self.makeResponse(status: 200)) },
            cacheURL: cacheURL,
        )
        await c.loadIfNeeded()
        // After load resolves, network result wins.
        XCTAssertEqual(c.stations.count, 3)
    }
}
