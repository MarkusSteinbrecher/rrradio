import XCTest
@testable import rrradio

final class CloudSyncMergeTests: XCTestCase {
    private func station(_ id: String, name: String? = nil) -> Station {
        Station(
            id: id,
            name: name ?? id.uppercased(),
            streamUrl: URL(string: "https://example.com/\(id)")!,
            country: "DE",
            tags: ["test"],
        )
    }

    private func snapshot(
        favorites: [Station] = [],
        customStations: [Station] = [],
        stationLists: [StationList] = [],
        theme: String = ThemeController.Choice.system.rawValue,
        themeAccent: String = ThemeController.classicAccentRawValue,
        locale: String = LocaleController.Choice.system.rawValue,
        sleepTimerDefaultMinutes: Int = SleepTimer.fallbackDefaultMinutes,
        landingPage: String = LandingPage.browse.rawValue,
        landingStationID: String = "",
        favoritesDisplayMode: String = FavoritesDisplayMode.list.rawValue,
        favoritesDisplayModeOrder: String = FavoritesDisplayMode.defaultRawValue,
        favoritesDisplayModeVisible: String = FavoritesDisplayMode.defaultRawValue,
        wakeDefaultTime: String = WakeAlarm.fallbackDefaultTime,
        wakeNotificationsEnabled: Bool = false,
        carModeAutomaticEnabled: Bool = true,
        carModeManualEnabled: Bool = false,
        listeningHistoryEnabled: Bool = false,
        listeningHistoryLevel: String = ListeningHistoryLevel.stations.rawValue,
        listeningHistoryRetention: String = ListeningHistoryRetention.days90.rawValue,
        favoritesOrder: [String] = [],
        resetAt: Date? = nil,
        hasPreferences: Bool = true,
    ) -> CloudSyncSnapshot {
        CloudSyncSnapshot(
            favorites: favorites,
            customStations: customStations,
            stationLists: stationLists,
            theme: theme,
            themeAccent: themeAccent,
            locale: locale,
            sleepTimerDefaultMinutes: sleepTimerDefaultMinutes,
            landingPage: landingPage,
            landingStationID: landingStationID,
            favoritesDisplayMode: favoritesDisplayMode,
            favoritesDisplayModeOrder: favoritesDisplayModeOrder,
            favoritesDisplayModeVisible: favoritesDisplayModeVisible,
            wakeDefaultTime: wakeDefaultTime,
            wakeNotificationsEnabled: wakeNotificationsEnabled,
            carModeAutomaticEnabled: carModeAutomaticEnabled,
            carModeManualEnabled: carModeManualEnabled,
            listeningHistoryEnabled: listeningHistoryEnabled,
            listeningHistoryLevel: listeningHistoryLevel,
            listeningHistoryRetention: listeningHistoryRetention,
            favoritesOrder: favoritesOrder,
            resetAt: resetAt,
            hasPreferences: hasPreferences,
        )
    }

    func testEmptyIncomingKeepsLocalFavorites() {
        let merged = CloudSyncMerge.merged(
            local: snapshot(favorites: [station("a"), station("b")]),
            remote: snapshot(),
        )

        XCTAssertEqual(merged.favorites.map(\.id), ["a", "b"])
    }

    func testOnlyLocalFavoritesStayLocal() {
        let merged = CloudSyncMerge.mergeFavorites(
            local: [station("a")],
            remote: [],
            remoteOrder: [],
        )

        XCTAssertEqual(merged.map(\.id), ["a"])
    }

    func testOnlyICloudFavoritesAreImported() {
        let merged = CloudSyncMerge.mergeFavorites(
            local: [],
            remote: [station("remote-a"), station("remote-b")],
            remoteOrder: ["remote-b", "remote-a"],
        )

        XCTAssertEqual(merged.map(\.id), ["remote-b", "remote-a"])
    }

    func testOverlapUpdatesStationSnapshotWithoutDuplicating() {
        let merged = CloudSyncMerge.mergeFavorites(
            local: [station("a", name: "Local A"), station("b")],
            remote: [station("a", name: "Cloud A"), station("c")],
            remoteOrder: [],
        )

        XCTAssertEqual(merged.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(merged.first?.name, "Cloud A")
    }

    func testConflictingRemoteReorderWinsWhenOrderRecordExists() {
        let merged = CloudSyncMerge.mergeFavorites(
            local: [station("a"), station("b"), station("c")],
            remote: [station("a"), station("b"), station("c")],
            remoteOrder: ["c", "a", "b"],
        )

        XCTAssertEqual(merged.map(\.id), ["c", "a", "b"])
    }

    func testIncomingFavoritesAppendWhenNoOrderRecordExists() {
        let merged = CloudSyncMerge.mergeFavorites(
            local: [station("a"), station("b")],
            remote: [station("b"), station("c")],
            remoteOrder: [],
        )

        XCTAssertEqual(merged.map(\.id), ["a", "b", "c"])
    }

    func testCustomStationsMergeById() {
        let merged = CloudSyncMerge.merged(
            local: snapshot(customStations: [station("custom-a", name: "Old")]),
            remote: snapshot(customStations: [station("custom-a", name: "New"), station("custom-b")]),
        )

        XCTAssertEqual(merged.customStations.map(\.id), ["custom-a", "custom-b"])
        XCTAssertEqual(merged.customStations.first?.name, "New")
    }

    func testStationListsRestoreInRemoteOrder() {
        let first = StationList(id: "list-a", name: "A", stations: [station("a")])
        let second = StationList(id: "list-b", name: "B", stations: [station("b")])
        let merged = CloudSyncMerge.merged(
            local: snapshot(),
            remote: snapshot(stationLists: [second, first]),
        )

        XCTAssertEqual(merged.stationLists.map(\.id), ["list-b", "list-a"])
        XCTAssertEqual(merged.stationLists.first?.stations.map(\.id), ["b"])
    }

    func testStationListsMergeByIdAndKeepLocalOnlyLists() {
        let localShared = StationList(id: "shared", name: "Old", stations: [station("old")])
        let localOnly = StationList(id: "local", name: "Local", stations: [station("local")])
        let remoteShared = StationList(id: "shared", name: "New", stations: [station("new")])
        let remoteOnly = StationList(id: "remote", name: "Remote", stations: [station("remote")])

        let merged = CloudSyncMerge.merged(
            local: snapshot(stationLists: [localShared, localOnly]),
            remote: snapshot(stationLists: [remoteShared, remoteOnly]),
        )

        XCTAssertEqual(merged.stationLists.map(\.id), ["shared", "remote", "local"])
        XCTAssertEqual(merged.stationLists.first?.name, "New")
        XCTAssertEqual(merged.stationLists.first?.stations.map(\.id), ["new"])
    }

    func testMissingRemotePreferencesKeepLocalSettings() {
        let merged = CloudSyncMerge.merged(
            local: snapshot(
                theme: ThemeController.Choice.dark.rawValue,
                themeAccent: "#AD96FF",
                landingPage: LandingPage.station.rawValue,
                favoritesDisplayMode: FavoritesDisplayMode.app.rawValue,
                favoritesDisplayModeOrder: "app,tiles,list",
                favoritesDisplayModeVisible: "app,tiles",
                wakeDefaultTime: "06:30",
                carModeManualEnabled: true,
                listeningHistoryRetention: ListeningHistoryRetention.forever.rawValue,
            ),
            remote: snapshot(hasPreferences: false),
        )

        XCTAssertEqual(merged.theme, ThemeController.Choice.dark.rawValue)
        XCTAssertEqual(merged.themeAccent, "#AD96FF")
        XCTAssertEqual(merged.landingPage, LandingPage.station.rawValue)
        XCTAssertEqual(merged.favoritesDisplayMode, FavoritesDisplayMode.app.rawValue)
        XCTAssertEqual(merged.favoritesDisplayModeOrder, "app,tiles,list")
        XCTAssertEqual(merged.favoritesDisplayModeVisible, "app,tiles")
        XCTAssertEqual(merged.wakeDefaultTime, "06:30")
        XCTAssertTrue(merged.carModeManualEnabled)
        XCTAssertEqual(merged.listeningHistoryRetention, ListeningHistoryRetention.forever.rawValue)
    }
}
