import Foundation
import Observation

/// Simple sleep timer matching the web app's cycle: off, 30, 60,
/// 90 minutes. When armed, it pauses playback after the selected delay.
@Observable
@MainActor
final class SleepTimer {
    static let cycleMinutes = [0, 30, 60, 90]
    static let defaultMinutesKey = "rrradio.sleep.defaultMinutes.v1"
    static let fallbackDefaultMinutes = 30

    private let defaults: UserDefaults
    private(set) var minutes: Int = 0
    private(set) var firesAt: Date?

    @ObservationIgnored
    private var timer: Timer?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if defaults.object(forKey: Self.defaultMinutesKey) == nil {
            defaults.set(Self.fallbackDefaultMinutes, forKey: Self.defaultMinutesKey)
        }
    }

    var isArmed: Bool { minutes > 0 && firesAt != nil }
    var defaultMinutes: Int {
        let stored = defaults.integer(forKey: Self.defaultMinutesKey)
        return stored > 0 ? stored : Self.fallbackDefaultMinutes
    }

    var chipText: String {
        guard isArmed else { return "" }
        return Self.format(minutes)
    }

    func countdownText(at date: Date = Date()) -> String {
        guard let firesAt else { return "" }
        return Self.formatCountdown(firesAt.timeIntervalSince(date))
    }

    func cycle(onFire: @escaping () -> Void) {
        guard minutes > 0 else {
            set(minutes: defaultMinutes, onFire: onFire)
            return
        }
        let idx = Self.cycleMinutes.firstIndex(of: minutes) ?? 0
        let next = Self.cycleMinutes[(idx + 1) % Self.cycleMinutes.count]
        set(minutes: next, onFire: onFire)
    }

    func setDefaultMinutes(_ next: Int) {
        guard next > 0 else { return }
        defaults.set(next, forKey: Self.defaultMinutesKey)
    }

    func set(minutes next: Int, onFire: @escaping () -> Void) {
        timer?.invalidate()
        timer = nil

        guard next > 0 else {
            minutes = 0
            firesAt = nil
            return
        }

        minutes = next
        firesAt = Date().addingTimeInterval(TimeInterval(next * 60))
        timer = Timer.scheduledTimer(withTimeInterval: TimeInterval(next * 60), repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.fire(onFire: onFire)
            }
        }
    }

    func cancel() {
        set(minutes: 0, onFire: {})
    }

    func fireNowForTesting(onFire: @escaping () -> Void) {
        fire(onFire: onFire)
    }

    private func fire(onFire: () -> Void) {
        timer?.invalidate()
        timer = nil
        minutes = 0
        firesAt = nil
        onFire()
    }

    static func format(_ minutes: Int) -> String {
        String(format: "%d:%02d", minutes / 60, minutes % 60)
    }

    private static func formatCountdown(_ interval: TimeInterval) -> String {
        if interval <= 0 { return "now" }
        let totalMinutes = max(1, Int(ceil(interval / 60)))
        return String(format: "%d:%02d", totalMinutes / 60, totalMinutes % 60)
    }
}
