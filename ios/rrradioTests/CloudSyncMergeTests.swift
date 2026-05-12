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
        theme: String = ThemeController.Choice.system.rawValue,
        locale: String = LocaleController.Choice.system.rawValue,
        sleepTimerDefaultMinutes: Int = SleepTimer.fallbackDefaultMinutes,
        landingPage: String = LandingPage.browse.rawValue,
        landingStationID: String = "",
        favoritesDisplayMode: String = FavoritesDisplayMode.list.rawValue,
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
            theme: theme,
            locale: locale,
            sleepTimerDefaultMinutes: sleepTimerDefaultMinutes,
            landingPage: landingPage,
            landingStationID: landingStationID,
            favoritesDisplayMode: favoritesDisplayMode,
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

    func testMissingRemotePreferencesKeepLocalSettings() {
        let merged = CloudSyncMerge.merged(
            local: snapshot(
                theme: ThemeController.Choice.dark.rawValue,
                landingPage: LandingPage.station.rawValue,
                favoritesDisplayMode: FavoritesDisplayMode.app.rawValue,
                wakeDefaultTime: "06:30",
                carModeManualEnabled: true,
                listeningHistoryRetention: ListeningHistoryRetention.forever.rawValue,
            ),
            remote: snapshot(hasPreferences: false),
        )

        XCTAssertEqual(merged.theme, ThemeController.Choice.dark.rawValue)
        XCTAssertEqual(merged.landingPage, LandingPage.station.rawValue)
        XCTAssertEqual(merged.favoritesDisplayMode, FavoritesDisplayMode.app.rawValue)
        XCTAssertEqual(merged.wakeDefaultTime, "06:30")
        XCTAssertTrue(merged.carModeManualEnabled)
        XCTAssertEqual(merged.listeningHistoryRetention, ListeningHistoryRetention.forever.rawValue)
    }
}
