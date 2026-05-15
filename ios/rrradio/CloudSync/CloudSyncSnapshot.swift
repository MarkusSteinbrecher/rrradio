import Foundation

struct CloudSyncSnapshot: Equatable {
    var favorites: [Station]
    var customStations: [Station]
    var stationLists: [StationList]
    var theme: String
    var themeAccent: String
    var locale: String
    var sleepTimerDefaultMinutes: Int
    var landingPage: String
    var landingStationID: String
    var favoritesDisplayMode: String
    var favoritesDisplayModeOrder: String
    var favoritesDisplayModeVisible: String
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

    var hasCloudData: Bool {
        hasPreferences
            || resetAt != nil
            || !favorites.isEmpty
            || !customStations.isEmpty
            || !stationLists.isEmpty
            || !favoritesOrder.isEmpty
    }

    var hasLocalUserPayload: Bool {
        !favorites.isEmpty
            || !customStations.isEmpty
            || !stationLists.isEmpty
            || !favoritesOrder.isEmpty
            || hasNonDefaultLocalPreferences
    }

    private var hasNonDefaultLocalPreferences: Bool {
        theme != ThemeController.Choice.system.rawValue
            || themeAccent != ThemeController.classicAccentRawValue
            || locale != LocaleController.Choice.system.rawValue
            || sleepTimerDefaultMinutes != SleepTimer.fallbackDefaultMinutes
            || landingPage != LandingPage.browse.rawValue
            || !landingStationID.isEmpty
            || favoritesDisplayMode != FavoritesDisplayMode.list.rawValue
            || favoritesDisplayModeOrder != FavoritesDisplayMode.defaultRawValue
            || favoritesDisplayModeVisible != FavoritesDisplayMode.defaultRawValue
            || wakeDefaultTime != WakeAlarm.fallbackDefaultTime
            || !wakeNotificationsEnabled
            || !carModeAutomaticEnabled
            || carModeManualEnabled
            || listeningHistoryEnabled
            || listeningHistoryLevel != ListeningHistoryLevel.stations.rawValue
            || listeningHistoryRetention != ListeningHistoryRetention.days90.rawValue
    }

    static let empty = CloudSyncSnapshot(
        favorites: [],
        customStations: [],
        stationLists: [],
        theme: ThemeController.Choice.system.rawValue,
        themeAccent: ThemeController.classicAccentRawValue,
        locale: LocaleController.Choice.system.rawValue,
        sleepTimerDefaultMinutes: SleepTimer.fallbackDefaultMinutes,
        landingPage: LandingPage.browse.rawValue,
        landingStationID: "",
        favoritesDisplayMode: FavoritesDisplayMode.list.rawValue,
        favoritesDisplayModeOrder: FavoritesDisplayMode.defaultRawValue,
        favoritesDisplayModeVisible: FavoritesDisplayMode.defaultRawValue,
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
            stationLists: mergeStationLists(local: local.stationLists, remote: remote.stationLists),
            theme: remote.hasPreferences ? remote.theme : local.theme,
            themeAccent: remote.hasPreferences ? remote.themeAccent : local.themeAccent,
            locale: remote.hasPreferences ? remote.locale : local.locale,
            sleepTimerDefaultMinutes: remote.hasPreferences && remote.sleepTimerDefaultMinutes > 0
                ? remote.sleepTimerDefaultMinutes
                : local.sleepTimerDefaultMinutes,
            landingPage: remote.hasPreferences ? remote.landingPage : local.landingPage,
            landingStationID: remote.hasPreferences ? remote.landingStationID : local.landingStationID,
            favoritesDisplayMode: remote.hasPreferences ? remote.favoritesDisplayMode : local.favoritesDisplayMode,
            favoritesDisplayModeOrder: remote.hasPreferences
                ? remote.favoritesDisplayModeOrder
                : local.favoritesDisplayModeOrder,
            favoritesDisplayModeVisible: remote.hasPreferences
                ? remote.favoritesDisplayModeVisible
                : local.favoritesDisplayModeVisible,
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

    static func mergeStationLists(local: [StationList], remote: [StationList]) -> [StationList] {
        var seen = Set<String>()
        var result: [StationList] = []

        for list in remote {
            if seen.insert(list.id).inserted {
                result.append(list)
            }
        }
        for list in local where seen.insert(list.id).inserted {
            result.append(list)
        }

        return result
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
