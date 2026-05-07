import XCTest
@testable import rrradio

private struct NoopWakeNotifier: WakeAlarmNotifying {
    func schedule(station: Station, time: String, firesAt: Date) {}
    func cancel() {}
}

@MainActor
final class WakeAlarmTests: XCTestCase {
    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "WakeAlarmTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testNextFireDateUsesTodayWhenTimeIsAhead() throws {
        let armedAt = try date("2026-05-07 09:00")

        let fire = try XCTUnwrap(WakeAlarm.nextFireDate(time: "17:30", armedAt: armedAt, calendar: calendar))

        XCTAssertEqual(fire, try date("2026-05-07 17:30"))
    }

    func testNextFireDateUsesTomorrowWhenTimeHasPassed() throws {
        let armedAt = try date("2026-05-07 21:00")

        let fire = try XCTUnwrap(WakeAlarm.nextFireDate(time: "07:30", armedAt: armedAt, calendar: calendar))

        XCTAssertEqual(fire, try date("2026-05-08 07:30"))
    }

    func testInvalidTimeDoesNotParse() throws {
        let armedAt = try date("2026-05-07 09:00")

        XCTAssertNil(WakeAlarm.nextFireDate(time: "25:00", armedAt: armedAt, calendar: calendar))
        XCTAssertNil(WakeAlarm.nextFireDate(time: "abc", armedAt: armedAt, calendar: calendar))
    }

    func testArmPersistsAndRestoresWake() throws {
        let now = try date("2026-05-07 09:00")
        let alarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })

        alarm.arm(station: station, time: "17:30")

        let restored = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        XCTAssertTrue(restored.isArmed)
        XCTAssertEqual(restored.time, "17:30")
        XCTAssertEqual(restored.station?.id, station.id)
        XCTAssertEqual(restored.chipText, "17:30")
    }

    func testDisarmClearsWake() throws {
        let now = try date("2026-05-07 09:00")
        let alarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        alarm.arm(station: station, time: "17:30")

        alarm.disarm()

        let restored = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        XCTAssertFalse(restored.isArmed)
        XCTAssertNil(restored.station)
    }

    func testFireClearsAndRunsCallback() throws {
        let now = try date("2026-05-07 09:00")
        let alarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        var firedStation: Station?
        alarm.activate { firedStation = $0 }
        alarm.arm(station: station, time: "17:30")

        alarm.fireNowForTesting()

        XCTAssertEqual(firedStation?.id, station.id)
        XCTAssertFalse(alarm.isArmed)
    }

    private var station: Station {
        Station(
            id: "test",
            name: "Test FM",
            streamUrl: URL(string: "https://example.com/stream.mp3")!,
        )
    }

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }

    private func date(_ string: String) throws -> Date {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return try XCTUnwrap(formatter.date(from: string))
    }
}
