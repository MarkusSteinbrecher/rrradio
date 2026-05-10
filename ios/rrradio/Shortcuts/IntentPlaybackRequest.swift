import Foundation

extension Notification.Name {
    static let intentPlaybackRequested = Notification.Name("rrradio.intentPlaybackRequested")
}

enum IntentPlaybackRequest {
    private static let pendingStationIDKey = "rrradio.intent.pendingStationID.v1"
    private static let pendingLastStationKey = "rrradio.intent.pendingLastStation.v1"

    static func requestPlay(stationID: String, defaults: UserDefaults = .standard) {
        defaults.set(stationID, forKey: pendingStationIDKey)
        defaults.set(false, forKey: pendingLastStationKey)
        NotificationCenter.default.post(name: .intentPlaybackRequested, object: nil)
    }

    static func requestPlayLastStation(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: pendingStationIDKey)
        defaults.set(true, forKey: pendingLastStationKey)
        NotificationCenter.default.post(name: .intentPlaybackRequested, object: nil)
    }

    static func consumePendingStation(
        from candidates: [Station],
        defaults: UserDefaults = .standard,
    ) -> Station? {
        if defaults.bool(forKey: pendingLastStationKey) {
            defaults.set(false, forKey: pendingLastStationKey)
            return Library.readStations(Library.Keys.recents, from: defaults).first
        }

        guard let stationID = defaults.string(forKey: pendingStationIDKey), !stationID.isEmpty else { return nil }
        defaults.removeObject(forKey: pendingStationIDKey)
        return candidates.first { $0.id == stationID }
    }
}
