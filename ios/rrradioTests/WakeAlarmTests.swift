import XCTest
import UserNotifications
@testable import rrradio

private struct NoopWakeNotifier: WakeAlarmNotifying {
    func schedule(station: Station, time: String, firesAt: Date) {}
    func cancel() {}
    func authorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void) {
        completion(.authorized)
    }
    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        completion(true)
    }
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

        alarm.arm(station: station, time: "17:30", keepAliveEnabled: true)

        let restored = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        XCTAssertTrue(restored.isArmed)
        XCTAssertEqual(restored.time, "17:30")
        XCTAssertEqual(restored.station?.id, station.id)
        XCTAssertEqual(restored.chipText, "17:30")
        XCTAssertTrue(restored.keepAliveEnabled)
    }

    func testKeepAliveDefaultPersistsAcrossNewWake() throws {
        let now = try date("2026-05-07 09:00")
        let alarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })

        alarm.arm(station: station, time: "17:30", keepAliveEnabled: true)
        alarm.disarm()

        let next = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        XCTAssertTrue(next.keepAliveEnabled)
    }

    func testNewWakeDefaultsNotificationsOn() throws {
        let now = try date("2026-05-07 09:00")

        let alarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })

        XCTAssertTrue(alarm.notificationsEnabled)
        XCTAssertTrue(defaults.bool(forKey: WakeAlarm.notificationsEnabledKey))
    }

    func testExistingStoredWakeKeepsMissingNotificationPreferenceOff() throws {
        let now = try date("2026-05-07 09:00")
        let legacy = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })
        legacy.setNotificationsEnabled(false)
        legacy.arm(station: station, time: "17:30")
        defaults.removeObject(forKey: WakeAlarm.notificationsEnabledKey)

        let restored = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier(), now: { now })

        XCTAssertFalse(restored.notificationsEnabled)
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
