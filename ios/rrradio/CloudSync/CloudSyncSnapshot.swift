import Foundation

struct CloudSyncSnapshot: Equatable {
    var favorites: [Station]
    var customStations: [Station]
    var theme: String
    var locale: String
    var sleepTimerDefaultMinutes: Int
    var favoritesOrder: [String]
    var resetAt: Date?

    static let empty = CloudSyncSnapshot(
        favorites: [],
        customStations: [],
        theme: ThemeController.Choice.system.rawValue,
        locale: LocaleController.Choice.system.rawValue,
        sleepTimerDefaultMinutes: SleepTimer.fallbackDefaultMinutes,
        favoritesOrder: [],
        resetAt: nil,
    )
}

enum CloudSyncMerge {
    static func merged(local: CloudSyncSnapshot, remote: CloudSyncSnapshot) -> CloudSyncSnapshot {
        CloudSyncSnapshot(
            favorites: mergeFavorites(
                local: local.favorites,
                remote: remote.favorites,
                remoteOrder: remote.favoritesOrder,
            ),
            customStations: mergeStations(local: local.customStations, remote: remote.customStations),
            theme: remote.theme.isEmpty ? local.theme : remote.theme,
            locale: remote.locale.isEmpty ? local.locale : remote.locale,
            sleepTimerDefaultMinutes: remote.sleepTimerDefaultMinutes > 0
                ? remote.sleepTimerDefaultMinutes
                : local.sleepTimerDefaultMinutes,
            favoritesOrder: remote.favoritesOrder,
            resetAt: remote.resetAt,
        )
    }

    static func mergeFavorites(
        local: [Station],
        remote: [Station],
        remoteOrder: [String],
    ) -> [Station] {
        let merged = mergeStations(local: local, remote: remote)
        guard !remoteOrder.isEmpty else { return merged }

        var byID = Dictionary(uniqueKeysWithValues: merged.map { ($0.id, $0) })
        var ordered: [Station] = []
        for id in remoteOrder {
            if let station = byID.removeValue(forKey: id) {
                ordered.append(station)
            }
        }
        ordered.append(contentsOf: merged.filter { byID[$0.id] != nil })
        return ordered
    }

    static func mergeStations(local: [Station], remote: [Station]) -> [Station] {
        var byID = Dictionary(uniqueKeysWithValues: local.map { ($0.id, $0) })
        var result = local

        for station in remote {
            if let idx = result.firstIndex(where: { $0.id == station.id }) {
                result[idx] = station
                byID[station.id] = station
            } else {
                result.append(station)
                byID[station.id] = station
            }
        }

        return result
    }
}
