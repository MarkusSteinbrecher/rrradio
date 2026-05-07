import XCTest
@testable import rrradio

@MainActor
final class SleepTimerTests: XCTestCase {
    func testStartsDisarmed() {
        let timer = SleepTimer()
        XCTAssertFalse(timer.isArmed)
        XCTAssertEqual(timer.minutes, 0)
        XCTAssertNil(timer.firesAt)
        XCTAssertEqual(timer.chipText, "")
    }

    func testCycleUsesWebDurations() {
        let timer = SleepTimer()

        timer.cycle {}
        XCTAssertEqual(timer.minutes, 15)
        XCTAssertEqual(timer.chipText, "15m")

        timer.cycle {}
        XCTAssertEqual(timer.minutes, 30)

        timer.cycle {}
        XCTAssertEqual(timer.minutes, 60)

        timer.cycle {}
        XCTAssertEqual(timer.minutes, 90)

        timer.cycle {}
        XCTAssertEqual(timer.minutes, 0)
        XCTAssertFalse(timer.isArmed)
    }

    func testSetZeroCancels() {
        let timer = SleepTimer()
        timer.set(minutes: 15) {}

        timer.set(minutes: 0) {}

        XCTAssertEqual(timer.minutes, 0)
        XCTAssertNil(timer.firesAt)
        XCTAssertFalse(timer.isArmed)
    }

    func testFireClearsStateAndRunsCallback() {
        let timer = SleepTimer()
        var fired = false
        timer.set(minutes: 15) {}

        timer.fireNowForTesting {
            fired = true
        }

        XCTAssertTrue(fired)
        XCTAssertEqual(timer.minutes, 0)
        XCTAssertNil(timer.firesAt)
        XCTAssertFalse(timer.isArmed)
    }
}
