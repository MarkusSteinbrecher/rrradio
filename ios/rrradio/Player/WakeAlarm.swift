import Foundation
import Observation
import UserNotifications

protocol WakeAlarmNotifying {
    func schedule(station: Station, time: String, firesAt: Date, title: String?)
    func cancel()
    func authorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void)
    func requestAuthorization(completion: @escaping (Bool) -> Void)
}

struct LocalWakeAlarmNotifier: WakeAlarmNotifying {
    private let identifier = "rrradio.wake.v1"

    func schedule(station: Station, time: String, firesAt: Date, title: String?) {
        authorizationStatus { status in
            guard status.allowsWakeNotification else {
                diagnosticRecordAsync("wake", "notification schedule skipped", details: ["authorization": status.diagnosticValue])
                return
            }
            let content = UNMutableNotificationContent()
            if let title, !title.isEmpty {
                content.title = title
                content.body = "Wake to \(station.name) at \(time). Open rrradio if playback did not start automatically."
            } else {
                content.title = "Wake to \(station.name)"
                content.body = "It is \(time). Open rrradio if playback did not start automatically."
            }
            content.sound = .default

            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: firesAt)
            let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
            UNUserNotificationCenter.current().add(request) { error in
                diagnosticRecordAsync(
                    "wake",
                    error == nil ? "notification scheduled" : "notification schedule failed",
                    details: [
                        "station": station.name,
                        "time": time,
                        "firesAt": ISO8601DateFormatter().string(from: firesAt),
                        "title": title ?? "",
                        "error": error?.localizedDescription ?? "",
                    ],
                )
            }
        }
    }

    func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
        diagnosticRecordAsync("wake", "notification cancelled")
    }

    func authorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            completion(settings.authorizationStatus)
        }
    }

    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            diagnosticRecordAsync("wake", "notification authorization", details: ["granted": String(granted)])
            completion(granted)
        }
    }
}

private extension UNAuthorizationStatus {
    var allowsWakeNotification: Bool {
        switch self {
        case .authorized, .provisional, .ephemeral:
            return true
        case .denied, .notDetermined:
            return false
        @unknown default:
            return false
        }
    }

    var diagnosticValue: String {
        switch self {
        case .notDetermined: "notDetermined"
        case .denied: "denied"
        case .authorized: "authorized"
        case .provisional: "provisional"
        case .ephemeral: "ephemeral"
        @unknown default: "unknown"
        }
    }
}

/// One-shot wake-to-radio alarm. Native iOS still cannot behave exactly
/// like Clock.app: a terminated third-party app cannot launch itself and
/// start audio. While the app is alive, this timer starts the chosen
/// station; an optional local notification can be scheduled as a fallback cue.
@Observable
@MainActor
final class WakeAlarm {
    private enum Keys {
        static let wake = "rrradio.wake.v1"
        static let lastTime = "rrradio.wake.lastTime.v1"
        static let notificationsEnabled = "rrradio.wake.notificationsEnabled.v1"
        static let pauseWarningSuppressed = "rrradio.wake.pauseWarningSuppressed.v1"
        static let keepAliveDefault = "rrradio.wake.keepAliveDefault.v1"
    }
    nonisolated static let defaultTimeKey = Keys.lastTime
    nonisolated static let notificationsEnabledKey = Keys.notificationsEnabled
    nonisolated static let fallbackDefaultTime = "07:00"

    private struct StoredWake: Codable {
        let time: String
        let station: Station
        let armedAt: Date
        let keepAliveEnabled: Bool?
        let title: String?
    }

    static let staleGrace: TimeInterval = 60

    private let defaults: UserDefaults
    private let notifier: WakeAlarmNotifying
    private let now: () -> Date

    private(set) var time: String
    private(set) var station: Station?
    private(set) var title: String?
    private(set) var armedAt: Date?
    private(set) var firesAt: Date?
    private(set) var notificationPermissionDenied = false
    private(set) var keepAliveEnabled: Bool
    var notificationsEnabled: Bool {
        didSet {
            defaults.set(notificationsEnabled, forKey: Keys.notificationsEnabled)
            diagnosticRecord("wake", "notification preference changed", details: ["enabled": String(notificationsEnabled)])
            if notificationsEnabled {
                scheduleWakeNotificationIfNeeded()
            } else {
                notifier.cancel()
            }
        }
    }

    @ObservationIgnored
    private var timer: Timer?
    @ObservationIgnored
    private var onFire: ((Station) -> Void)?
    @ObservationIgnored var onPreferencesChanged: (() -> Void)?
    @ObservationIgnored
    private var pauseWarningArmedAt: Date?

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
        keepAliveEnabled = Self.defaultKeepAliveEnabled(from: defaults)
        let storedWake = Self.readWake(from: defaults)
        if defaults.object(forKey: Keys.notificationsEnabled) == nil {
            let defaultEnabled = storedWake == nil
            notificationsEnabled = defaultEnabled
            defaults.set(defaultEnabled, forKey: Keys.notificationsEnabled)
        } else {
            notificationsEnabled = defaults.bool(forKey: Keys.notificationsEnabled)
        }

        if let stored = storedWake,
           let next = Self.nextFireDate(time: stored.time, armedAt: stored.armedAt) {
            let remaining = next.timeIntervalSince(now())
            if remaining >= -Self.staleGrace {
                time = stored.time
                station = stored.station
                title = stored.title
                armedAt = stored.armedAt
                firesAt = next
                keepAliveEnabled = stored.keepAliveEnabled ?? Self.defaultKeepAliveEnabled(from: defaults)
                diagnosticRecord("wake", "restored", details: wakeDetails(station: stored.station, firesAt: next))
            } else {
                diagnosticRecord("wake", "cleared stale stored alarm")
                Self.clearWake(from: defaults)
            }
        } else {
            Self.clearWake(from: defaults)
        }

        if !notificationsEnabled {
            notifier.cancel()
        }
        refreshNotificationAuthorization()
    }

    func activate(onFire: @escaping (Station) -> Void) {
        self.onFire = onFire
        diagnosticRecord("wake", "activated", details: ["armed": String(isArmed)])
        guard isArmed else { return }
        scheduleTimer()
        scheduleWakeNotificationIfNeeded()
        if let firesAt, firesAt <= now() {
            fire()
        }
    }

    func arm(
        station: Station,
        time nextTime: String,
        title nextTitle: String? = nil,
        keepAliveEnabled nextKeepAliveEnabled: Bool? = nil,
        onFire: ((Station) -> Void)? = nil,
    ) {
        let cleanTime = nextTime.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanTitle = Self.cleanTitle(nextTitle)
        let armed = now()
        guard let nextFire = Self.nextFireDate(time: cleanTime, armedAt: armed) else { return }

        timer?.invalidate()
        if let onFire {
            self.onFire = onFire
        }
        time = cleanTime
        self.station = station
        title = cleanTitle
        armedAt = armed
        firesAt = nextFire
        keepAliveEnabled = nextKeepAliveEnabled ?? keepAliveEnabled
        defaults.set(keepAliveEnabled, forKey: Keys.keepAliveDefault)
        pauseWarningArmedAt = nil
        writeWake()
        diagnosticRecord("wake", "armed", details: wakeDetails(station: station, firesAt: nextFire))
        scheduleTimer()
        scheduleWakeNotificationIfNeeded()
    }

    func setKeepAliveEnabled(_ enabled: Bool) {
        keepAliveEnabled = enabled
        defaults.set(enabled, forKey: Keys.keepAliveDefault)
        if isArmed {
            writeWake()
        }
    }

    func requestNotificationAuthorizationIfNeeded() async -> Bool {
        let status = await currentAuthorizationStatus()
        if status == .denied {
            notificationPermissionDenied = true
            return false
        }
        guard status == .notDetermined else {
            notificationPermissionDenied = false
            return status.allowsWakeNotification
        }
        let granted = await withCheckedContinuation { continuation in
            notifier.requestAuthorization { granted in
                continuation.resume(returning: granted)
            }
        }
        notificationPermissionDenied = !granted
        return granted
    }

    func refreshNotificationAuthorization() {
        Task { @MainActor in
            let status = await currentAuthorizationStatus()
            notificationPermissionDenied = status == .denied
        }
    }

    func shouldShowPauseWarning() -> Bool {
        guard isArmed, !defaults.bool(forKey: Keys.pauseWarningSuppressed) else { return false }
        guard !keepAliveEnabled else { return false }
        guard pauseWarningArmedAt != armedAt else { return false }
        pauseWarningArmedAt = armedAt
        return true
    }

    func suppressPauseWarning() {
        defaults.set(true, forKey: Keys.pauseWarningSuppressed)
    }

    func setNotificationsEnabled(_ enabled: Bool) {
        notificationsEnabled = enabled
        onPreferencesChanged?()
    }

    func setDefaultTime(_ nextTime: String) {
        defaults.set(nextTime, forKey: Keys.lastTime)
        if !isArmed {
            time = nextTime
        }
        onPreferencesChanged?()
    }

    func applyCloudSyncPreferences(defaultTime: String, notificationsEnabled nextNotificationsEnabled: Bool) {
        let cleanTime = defaultTime.trimmingCharacters(in: .whitespacesAndNewlines)
        if Self.nextFireDate(time: cleanTime, armedAt: now()) != nil {
            defaults.set(cleanTime, forKey: Keys.lastTime)
            if !isArmed {
                time = cleanTime
            }
        }
        notificationsEnabled = nextNotificationsEnabled
    }

    func disarm() {
        timer?.invalidate()
        timer = nil
        diagnosticRecord("wake", "disarmed", details: station.map { wakeDetails(station: $0, firesAt: firesAt) } ?? [:])
        station = nil
        title = nil
        armedAt = nil
        firesAt = nil
        keepAliveEnabled = Self.defaultKeepAliveEnabled(from: defaults)
        pauseWarningArmedAt = nil
        time = defaults.string(forKey: Keys.lastTime) ?? Self.fallbackDefaultTime
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
        diagnosticRecord("wake", "timer scheduled", details: ["seconds": String(Int(interval)), "firesAt": ISO8601DateFormatter().string(from: firesAt)])
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.fire()
            }
        }
    }

    private func scheduleWakeNotificationIfNeeded() {
        guard notificationsEnabled, let station, let firesAt else {
            notifier.cancel()
            diagnosticRecord("wake", "notification skipped", details: ["enabled": String(notificationsEnabled)])
            return
        }
        notifier.schedule(station: station, time: time, firesAt: firesAt, title: title)
    }

    private func currentAuthorizationStatus() async -> UNAuthorizationStatus {
        await withCheckedContinuation { continuation in
            notifier.authorizationStatus { status in
                continuation.resume(returning: status)
            }
        }
    }

    private func fire() {
        guard let station else { return }
        timer?.invalidate()
        timer = nil
        let target = station
        diagnosticRecord("wake", "timer fired", details: wakeDetails(station: target, firesAt: firesAt))
        disarm()
        onFire?(target)
    }

    private func wakeDetails(station: Station, firesAt: Date?) -> [String: String] {
        var details = [
            "station": station.name,
            "stationID": station.id,
            "streamHost": station.streamUrl.host() ?? "",
            "time": time,
            "firesAt": firesAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
            "keepAlive": String(keepAliveEnabled),
        ]
        if let title {
            details["title"] = title
        }
        return details
    }

    private func writeWake() {
        guard let station, let armedAt,
              let data = try? JSONEncoder().encode(StoredWake(
                time: time,
                station: station,
                armedAt: armedAt,
                keepAliveEnabled: keepAliveEnabled,
                title: title,
              )) else {
            return
        }
        defaults.set(data, forKey: Keys.wake)
    }

    private static func readWake(from defaults: UserDefaults) -> StoredWake? {
        guard let data = defaults.data(forKey: Keys.wake) else { return nil }
        return try? JSONDecoder().decode(StoredWake.self, from: data)
    }

    private static func defaultKeepAliveEnabled(from defaults: UserDefaults) -> Bool {
        guard defaults.object(forKey: Keys.keepAliveDefault) != nil else { return true }
        return defaults.bool(forKey: Keys.keepAliveDefault)
    }

    private static func cleanTitle(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private static func clearWake(from defaults: UserDefaults) {
        defaults.removeObject(forKey: Keys.wake)
    }
}
