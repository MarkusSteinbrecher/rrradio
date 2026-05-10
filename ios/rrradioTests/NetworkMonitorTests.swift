import XCTest
@testable import rrradio

final class NetworkMonitorTests: XCTestCase {
    func testOfflineSnapshotShowsNoInternetLabel() {
        let snapshot = NetworkSnapshot(
            status: .unsatisfied,
            isExpensive: false,
            isConstrained: false,
            interfaces: [],
        )

        XCTAssertTrue(snapshot.isOffline)
        XCTAssertEqual(snapshot.shortLabel, "No internet connection")
        XCTAssertEqual(snapshot.detail(isReconnecting: false), "Streams and catalog updates are offline.")
    }

    func testRequiresConnectionCountsAsOffline() {
        let snapshot = NetworkSnapshot(
            status: .requiresConnection,
            isExpensive: false,
            isConstrained: false,
            interfaces: [.wifi],
        )

        XCTAssertTrue(snapshot.isOffline)
        XCTAssertEqual(snapshot.shortLabel, "Connection required")
    }

    func testConstrainedOnlineSnapshotShowsLowDataMode() {
        let snapshot = NetworkSnapshot(
            status: .satisfied,
            isExpensive: false,
            isConstrained: true,
            interfaces: [.cellular],
        )

        XCTAssertFalse(snapshot.isOffline)
        XCTAssertEqual(snapshot.shortLabel, "Low Data Mode")
        XCTAssertEqual(snapshot.primaryInterface, .cellular)
    }

    func testNormalOnlineSnapshotStaysHidden() {
        let snapshot = NetworkSnapshot(
            status: .satisfied,
            isExpensive: false,
            isConstrained: false,
            interfaces: [.wifi],
        )

        XCTAssertNil(snapshot.shortLabel)
        XCTAssertNil(snapshot.detail(isReconnecting: false))
    }

    @MainActor
    func testMonitorCanApplySnapshotForTests() {
        let monitor = NetworkMonitor(startsAutomatically: false)
        let snapshot = NetworkSnapshot(
            status: .unsatisfied,
            isExpensive: false,
            isConstrained: false,
            interfaces: [],
        )

        monitor.apply(snapshot)

        XCTAssertEqual(monitor.snapshot, snapshot)
    }
}
