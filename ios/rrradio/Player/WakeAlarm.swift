import Foundation
import Observation
import UserNotifications

protocol WakeAlarmNotifying {
    func schedule(station: Station, time: String, firesAt: Date)
    func cancel()
}

struct LocalWakeAlarmNotifier: WakeAlarmNotifying {
    private let identifier = "rrradio.wake.v1"

    func schedule(station: Station, time: String, firesAt: Date) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = "Wake to \(station.name)"
            content.body = "It is \(time). Open rrradio if playback did not start automatically."
            content.sound = .default

            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: firesAt)
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
            UNUserNotificationCenter.current().add(request)
        }
    }

    func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }
}

/// One-shot wake-to-radio alarm. Native iOS still cannot behave exactly
/// like Clock.app: a terminated third-party app cannot launch itself and
/// start audio. While the app is alive, this timer starts the chosen
/// station; a local notification is scheduled as a fallback cue.
@Observable
@MainActor
final class WakeAlarm {
    private enum Keys {
        static let wake = "rrradio.wake.v1"
        static let lastTime = "rrradio.wake.lastTime.v1"
    }
    static let defaultTimeKey = Keys.lastTime
    static let fallbackDefaultTime = "07:00"

    private struct StoredWake: Codable {
        let time: String
        let station: Station
        let armedAt: Date
    }

    static let staleGrace: TimeInterval = 60

    private let defaults: UserDefaults
    private let notifier: WakeAlarmNotifying
    private let now: () -> Date

    private(set) var time: String
    private(set) var station: Station?
    private(set) var armedAt: Date?
    private(set) var firesAt: Date?

    @ObservationIgnored
    private var timer: Timer?
    @ObservationIgnored
    private var onFire: ((Station) -> Void)?

    var isArmed: Bool { station != nil && armedAt != nil && firesAt != nil }
    var chipText: String { isArmed ? time : "" }

    var countdownText: String {
        guard let firesAt else { return "" }
        return Self.formatCountdown(firesAt.timeIntervalSince(now()))
    }

    init(
        defaults: UserDefaults = .standard,
        notifier: WakeAlarmNotifying = LocalWakeAlarmNotifier(),
        now: @escaping () -> Date = Date.init,
    ) {
        self.defaults = defaults
        self.notifier = notifier
        self.now = now
        time = defaults.string(forKey: Keys.lastTime) ?? Self.fallbackDefaultTime

        if let stored = Self.readWake(from: defaults),
           let next = Self.nextFireDate(time: stored.time, armedAt: stored.armedAt) {
            let remaining = next.timeIntervalSince(now())
            if remaining >= -Self.staleGrace {
                time = stored.time
                station = stored.station
                armedAt = stored.armedAt
                firesAt = next
            } else {
                Self.clearWake(from: defaults)
            }
        } else {
            Self.clearWake(from: defaults)
        }
    }

    func activate(onFire: @escaping (Station) -> Void) {
        self.onFire = onFire
        guard isArmed else { return }
        scheduleTimer()
        if let station, let firesAt {
            notifier.schedule(station: station, time: time, firesAt: firesAt)
        }
        if let firesAt, firesAt <= now() {
            fire()
        }
    }

    func arm(station: Station, time nextTime: String, onFire: ((Station) -> Void)? = nil) {
        let cleanTime = nextTime.trimmingCharacters(in: .whitespacesAndNewlines)
        let armed = now()
        guard let nextFire = Self.nextFireDate(time: cleanTime, armedAt: armed) else { return }

        timer?.invalidate()
        if let onFire {
            self.onFire = onFire
        }
        time = cleanTime
        self.station = station
        armedAt = armed
        firesAt = nextFire
        defaults.set(cleanTime, forKey: Keys.lastTime)
        writeWake()
        scheduleTimer()
        notifier.schedule(station: station, time: cleanTime, firesAt: nextFire)
    }

    func setDefaultTime(_ nextTime: String) {
        defaults.set(nextTime, forKey: Keys.lastTime)
        if !isArmed {
            time = nextTime
        }
    }

    func disarm() {
        timer?.invalidate()
        timer = nil
        station = nil
        armedAt = nil
        firesAt = nil
        Self.clearWake(from: defaults)
        notifier.cancel()
    }

    func fireNowForTesting() {
        fire()
    }

    static func nextFireDate(time: String, armedAt: Date, calendar: Calendar = .current) -> Date? {
        let parts = time.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else {
            return nil
        }

        var components = calendar.dateComponents([.year, .month, .day], from: armedAt)
        components.hour = hour
        components.minute = minute
        components.second = 0
        guard let sameDay = calendar.date(from: components) else { return nil }
        if sameDay > armedAt { return sameDay }
        return calendar.date(byAdding: .day, value: 1, to: sameDay)
    }

    static func formatCountdown(_ interval: TimeInterval) -> String {
        if interval <= 0 { return "now" }
        let totalMinutes = Int(interval / 60)
        if totalMinutes < 1 { return "soon" }
        if totalMinutes < 60 { return "in \(totalMinutes)m" }
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        return minutes == 0 ? "in \(hours)h" : "in \(hours)h \(minutes)m"
    }

    private func scheduleTimer() {
        timer?.invalidate()
        guard let firesAt else { return }
        let interval = max(0, firesAt.timeIntervalSince(now()))
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.fire()
            }
        }
    }

    private func fire() {
        guard let station else { return }
        timer?.invalidate()
        timer = nil
        let target = station
        disarm()
        onFire?(target)
    }

    private func writeWake() {
        guard let station, let armedAt,
              let data = try? JSONEncoder().encode(StoredWake(time: time, station: station, armedAt: armedAt)) else {
            return
        }
        defaults.set(data, forKey: Keys.wake)
    }

    private static func readWake(from defaults: UserDefaults) -> StoredWake? {
        guard let data = defaults.data(forKey: Keys.wake) else { return nil }
        return try? JSONDecoder().decode(StoredWake.self, from: data)
    }

    private static func clearWake(from defaults: UserDefaults) {
        defaults.removeObject(forKey: Keys.wake)
    }
}
