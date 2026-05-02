import XCTest
@testable import rrradio

/// Catalog state contract. Audit #72.
///
/// The cache-fallback path inside `loadIfNeeded()` reads/writes the
/// user's Caches directory directly — we can't intercept that without
/// a URLSession injection point, which would be a larger refactor.
/// Tracked as a follow-up. These tests cover the deterministic parts
/// of the contract.
@MainActor
final class CatalogCacheTests: XCTestCase {
    func testStartsIdleWithEmptyStations() {
        let c = Catalog()
        XCTAssertEqual(c.state, .idle)
        XCTAssertTrue(c.stations.isEmpty)
        XCTAssertTrue(c.browseOrdered.isEmpty)
    }

    func testCanonicalURLPointsAtRrradioOrg() {
        XCTAssertEqual(Catalog.canonicalURL.host, "rrradio.org")
        XCTAssertEqual(Catalog.canonicalURL.scheme, "https")
        XCTAssertEqual(Catalog.canonicalURL.path, "/stations.json")
    }
}
