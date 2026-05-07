import Foundation
import Observation

/// Simple sleep timer matching the web app's cycle: off, 15, 30, 60,
/// 90 minutes. When armed, it pauses playback after the selected delay.
@Observable
@MainActor
final class SleepTimer {
    static let cycleMinutes = [0, 15, 30, 60, 90]

    private(set) var minutes: Int = 0
    private(set) var firesAt: Date?

    @ObservationIgnored
    private var timer: Timer?

    var isArmed: Bool { minutes > 0 && firesAt != nil }

    var chipText: String {
        isArmed ? "\(minutes)m" : ""
    }

    func cycle(onFire: @escaping () -> Void) {
        let idx = Self.cycleMinutes.firstIndex(of: minutes) ?? 0
        let next = Self.cycleMinutes[(idx + 1) % Self.cycleMinutes.count]
        set(minutes: next, onFire: onFire)
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
}
