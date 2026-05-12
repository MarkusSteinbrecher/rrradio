import Foundation

struct CloudSyncSnapshot: Equatable {
    var favorites: [Station]
    var customStations: [Station]
    var theme: String
    var locale: String
    var sleepTimerDefaultMinutes: Int
    var landingPage: String
    var landingStationID: String
    var favoritesDisplayMode: String
    var wakeDefaultTime: String
    var wakeNotificationsEnabled: Bool
    var carModeAutomaticEnabled: Bool
    var carModeManualEnabled: Bool
    var listeningHistoryEnabled: Bool
    var listeningHistoryLevel: String
    var listeningHistoryRetention: String
    var favoritesOrder: [String]
    var resetAt: Date?
    var hasPreferences: Bool

    static let empty = CloudSyncSnapshot(
        favorites: [],
        customStations: [],
        theme: ThemeController.Choice.system.rawValue,
        locale: LocaleController.Choice.system.rawValue,
        sleepTimerDefaultMinutes: SleepTimer.fallbackDefaultMinutes,
        landingPage: LandingPage.browse.rawValue,
        landingStationID: "",
        favoritesDisplayMode: FavoritesDisplayMode.list.rawValue,
        wakeDefaultTime: WakeAlarm.fallbackDefaultTime,
        wakeNotificationsEnabled: false,
        carModeAutomaticEnabled: true,
        carModeManualEnabled: false,
        listeningHistoryEnabled: false,
        listeningHistoryLevel: ListeningHistoryLevel.stations.rawValue,
        listeningHistoryRetention: ListeningHistoryRetention.days90.rawValue,
        favoritesOrder: [],
        resetAt: nil,
        hasPreferences: false,
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
            theme: remote.hasPreferences ? remote.theme : local.theme,
            locale: remote.hasPreferences ? remote.locale : local.locale,
            sleepTimerDefaultMinutes: remote.hasPreferences && remote.sleepTimerDefaultMinutes > 0
                ? remote.sleepTimerDefaultMinutes
                : local.sleepTimerDefaultMinutes,
            landingPage: remote.hasPreferences ? remote.landingPage : local.landingPage,
            landingStationID: remote.hasPreferences ? remote.landingStationID : local.landingStationID,
            favoritesDisplayMode: remote.hasPreferences ? remote.favoritesDisplayMode : local.favoritesDisplayMode,
            wakeDefaultTime: remote.hasPreferences ? remote.wakeDefaultTime : local.wakeDefaultTime,
            wakeNotificationsEnabled: remote.hasPreferences
                ? remote.wakeNotificationsEnabled
                : local.wakeNotificationsEnabled,
            carModeAutomaticEnabled: remote.hasPreferences
                ? remote.carModeAutomaticEnabled
                : local.carModeAutomaticEnabled,
            carModeManualEnabled: remote.hasPreferences
                ? remote.carModeManualEnabled
                : local.carModeManualEnabled,
            listeningHistoryEnabled: remote.hasPreferences
                ? remote.listeningHistoryEnabled
                : local.listeningHistoryEnabled,
            listeningHistoryLevel: remote.hasPreferences
                ? remote.listeningHistoryLevel
                : local.listeningHistoryLevel,
            listeningHistoryRetention: remote.hasPreferences
                ? remote.listeningHistoryRetention
                : local.listeningHistoryRetention,
            favoritesOrder: remote.favoritesOrder,
            resetAt: remote.resetAt,
            hasPreferences: local.hasPreferences || remote.hasPreferences,
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
