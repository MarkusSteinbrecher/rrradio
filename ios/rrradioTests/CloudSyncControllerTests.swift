import CloudKit
import UserNotifications
import XCTest
@testable import rrradio

@MainActor
final class CloudSyncControllerTests: XCTestCase {
    func testRefreshImportsRemoteSnapshotBeforeFirstPush() async throws {
        let defaults = makeDefaults()
        let favoriteA = station("remote-a")
        let favoriteB = station("remote-b")
        let custom = station("custom-a", name: "Custom A")
        let stationList = StationList(id: "list-a", name: "Morning", stations: [favoriteA, custom])
        let remote = snapshot(
            favorites: [favoriteA, favoriteB],
            customStations: [custom],
            stationLists: [stationList],
            theme: ThemeController.Choice.dark.rawValue,
            themeAccent: "#0A84FF",
            locale: LocaleController.Choice.german.rawValue,
            sleepTimerDefaultMinutes: 60,
            landingPage: LandingPage.favorites.rawValue,
            landingStationID: favoriteB.id,
            favoritesDisplayMode: FavoritesDisplayMode.tiles.rawValue,
            favoritesDisplayModeOrder: FavoritesDisplayMode.encode([.app, .tiles, .list]),
            favoritesDisplayModeVisible: FavoritesDisplayMode.encode([.app, .tiles]),
            wakeDefaultTime: "06:45",
            wakeNotificationsEnabled: false,
            carModeAutomaticEnabled: false,
            carModeManualEnabled: true,
            listeningHistoryEnabled: true,
            listeningHistoryLevel: ListeningHistoryLevel.tracks.rawValue,
            listeningHistoryRetention: ListeningHistoryRetention.forever.rawValue,
            favoritesOrder: [favoriteB.id, favoriteA.id],
        )
        let store = FakeCloudSyncStore(snapshot: remote)
        let dependencies = makeDependencies(defaults: defaults, store: store)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(dependencies.library.favorites.map(\.id), [custom.id, favoriteB.id, favoriteA.id])
        XCTAssertEqual(dependencies.library.customStations.map(\.id), [custom.id])
        XCTAssertEqual(dependencies.library.stationLists.map(\.id), [stationList.id])
        XCTAssertEqual(dependencies.library.stationLists.first?.stations.map(\.id), [favoriteA.id, custom.id])
        XCTAssertEqual(dependencies.theme.choice, .dark)
        XCTAssertEqual(dependencies.theme.accentRawValue, "#0A84FF")
        XCTAssertEqual(dependencies.locale.choice, .german)
        XCTAssertEqual(dependencies.sleepTimer.defaultMinutes, 60)
        XCTAssertEqual(defaults.string(forKey: LandingPage.storageKey), LandingPage.favorites.rawValue)
        XCTAssertEqual(defaults.string(forKey: LandingPage.stationIDKey), favoriteB.id)
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.storageKey), FavoritesDisplayMode.tiles.rawValue)
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.orderStorageKey), "app,tiles,list")
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.visibleStorageKey), "app,tiles")
        XCTAssertEqual(dependencies.wakeAlarm.time, "06:45")
        XCTAssertFalse(dependencies.wakeAlarm.notificationsEnabled)
        XCTAssertFalse(dependencies.carMode.automaticEnabled)
        XCTAssertTrue(dependencies.carMode.manualEnabled)
        XCTAssertTrue(dependencies.listeningHistory.isEnabled)
        XCTAssertEqual(dependencies.listeningHistory.level, .tracks)
        XCTAssertEqual(dependencies.listeningHistory.retention, .forever)
        XCTAssertEqual(
            dependencies.controller.diagnosticState,
            .restored(.init(favorites: 2, customStations: 1, stationLists: 1, hasPreferences: true)),
        )

        let saved = await store.savedSnapshots()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.favorites.map(\.id), [custom.id, favoriteB.id, favoriteA.id])
        XCTAssertEqual(saved.first?.customStations.map(\.id), [custom.id])
        XCTAssertEqual(saved.first?.stationLists.map(\.id), [stationList.id])
        XCTAssertEqual(saved.first?.favoritesDisplayMode, FavoritesDisplayMode.tiles.rawValue)
        XCTAssertEqual(saved.first?.themeAccent, "#0A84FF")
        XCTAssertEqual(saved.first?.favoritesDisplayModeOrder, "app,tiles,list")
        XCTAssertEqual(saved.first?.favoritesDisplayModeVisible, "app,tiles")
    }

    func testStationListChangesArePushedToCloud() async throws {
        let defaults = makeDefaults()
        let store = FakeCloudSyncStore(snapshot: .empty)
        let dependencies = makeDependencies(defaults: defaults, store: store)
        let stationA = station("station-a")

        let list = dependencies.library.createStationList(name: "Road", stations: [stationA])

        let saved = await waitForSavedSnapshot(in: store)
        XCTAssertEqual(saved?.stationLists.map(\.id), [list.id])
        XCTAssertEqual(saved?.stationLists.first?.stations.map(\.id), [stationA.id])
    }

    func testLocalChangeDuringInFlightPushIsPushedAfterSyncFinishes() async throws {
        let defaults = makeDefaults()
        let store = FakeCloudSyncStore(
            snapshot: .empty,
            saveDelayNanoseconds: 90_000_000,
        )
        let dependencies = makeDependencies(
            defaults: defaults,
            store: store,
            pushDebounceNanoseconds: 5_000_000,
        )
        let first = station("first")
        let second = station("second")

        dependencies.library.addFavorite(first)
        try await Task.sleep(nanoseconds: 30_000_000)
        dependencies.library.addFavorite(second)

        let saved = await waitForSavedSnapshot(in: store, minimumCount: 2)
        XCTAssertEqual(saved?.favorites.map(\.id), [second.id, first.id])
    }

    func testResetMarkerWithRemotePayloadIsTreatedAsStale() async throws {
        let defaults = makeDefaults()
        let remote = station("remote-a")
        let store = FakeCloudSyncStore(
            snapshot: snapshot(
                favorites: [remote],
                favoritesOrder: [remote.id],
                resetAt: Date(timeIntervalSince1970: 1_700_000_000),
            ),
        )
        let dependencies = makeDependencies(defaults: defaults, store: store)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(dependencies.library.favorites.map(\.id), [remote.id])
        XCTAssertEqual(dependencies.controller.diagnosticState, .restored(.init(favorites: 1, customStations: 0, stationLists: 0, hasPreferences: true)))
        let saved = await store.savedSnapshots()
        XCTAssertNil(saved.last?.resetAt)
    }

    func testEmptyFreshInstallDoesNotUploadLocalDefaults() async throws {
        let defaults = makeDefaults()
        let store = FakeCloudSyncStore(snapshot: .empty)
        let dependencies = makeDependencies(defaults: defaults, store: store)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(dependencies.controller.diagnosticState, .emptyRemote)
        let saved = await store.savedSnapshots()
        XCTAssertTrue(saved.isEmpty)
    }

    func testFetchFailureDoesNotApplyOrSavePartialData() async throws {
        let defaults = makeDefaults()
        let local = station("local-a")
        let store = FakeCloudSyncStore(
            snapshot: snapshot(favorites: [station("remote-a")]),
            fetchError: CloudSyncRecordFetchError(recordNames: ["favorite-remote-a"]),
        )
        let dependencies = makeDependencies(defaults: defaults, store: store, configure: false)
        dependencies.library.addFavorite(local)
        configure(dependencies)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(dependencies.library.favorites.map(\.id), [local.id])
        let saved = await store.savedSnapshots()
        XCTAssertTrue(saved.isEmpty)
        XCTAssertEqual(
            dependencies.controller.diagnosticState,
            .failed("iCloud schema or record fetch failed. Local data was not changed."),
        )
    }

    func testInvalidRemotePreferenceEnumsDoNotClobberLocalChoices() async throws {
        let defaults = makeDefaults()
        defaults.set(ThemeController.Choice.dark.rawValue, forKey: "rrradio.theme")
        defaults.set("#FF7AA3", forKey: ThemeController.accentStorageKey)
        defaults.set(LocaleController.Choice.german.rawValue, forKey: "rrradio.locale")
        defaults.set(FavoritesDisplayMode.app.rawValue, forKey: FavoritesDisplayMode.storageKey)
        defaults.set("app,list,tiles", forKey: FavoritesDisplayMode.orderStorageKey)
        defaults.set("app,list", forKey: FavoritesDisplayMode.visibleStorageKey)
        defaults.set(true, forKey: ListeningHistory.enabledKey)
        defaults.set(ListeningHistoryLevel.tracks.rawValue, forKey: ListeningHistoryLevel.storageKey)
        defaults.set(ListeningHistoryRetention.forever.rawValue, forKey: ListeningHistoryRetention.storageKey)
        let store = FakeCloudSyncStore(
            snapshot: snapshot(
                theme: "future-theme",
                themeAccent: "future-accent",
                locale: "future-locale",
                favoritesDisplayMode: "future-display",
                favoritesDisplayModeOrder: "future-order",
                favoritesDisplayModeVisible: "future-visible",
                listeningHistoryLevel: "future-level",
                listeningHistoryRetention: "future-retention",
            ),
        )
        let dependencies = makeDependencies(defaults: defaults, store: store)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(dependencies.theme.choice, .dark)
        XCTAssertEqual(dependencies.theme.accentRawValue, "#FF7AA3")
        XCTAssertEqual(dependencies.locale.choice, .german)
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.storageKey), FavoritesDisplayMode.app.rawValue)
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.orderStorageKey), "app,list,tiles")
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.visibleStorageKey), "app,list")
        XCTAssertTrue(dependencies.listeningHistory.isEnabled)
        XCTAssertEqual(dependencies.listeningHistory.level, .tracks)
        XCTAssertEqual(dependencies.listeningHistory.retention, .forever)
    }

    func testPendingLocalSettingsSurviveLaunchRefreshBeforeCloudPush() async throws {
        let defaults = makeDefaults()
        defaults.set(FavoritesDisplayMode.tiles.rawValue, forKey: FavoritesDisplayMode.storageKey)
        let staleRemote = snapshot(favoritesDisplayMode: FavoritesDisplayMode.list.rawValue)
        let markerController = CloudSyncController(
            defaults: defaults,
            store: FakeCloudSyncStore(snapshot: staleRemote),
            pushDebounceNanoseconds: 60_000_000_000,
        )
        markerController.noteSettingsChanged()
        XCTAssertTrue(defaults.bool(forKey: CloudSyncController.pendingPreferencesPushKey))

        let store = FakeCloudSyncStore(snapshot: staleRemote)
        let dependencies = makeDependencies(defaults: defaults, store: store)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.storageKey), FavoritesDisplayMode.tiles.rawValue)
        XCTAssertFalse(defaults.bool(forKey: CloudSyncController.pendingPreferencesPushKey))
        let saved = await store.savedSnapshots()
        XCTAssertEqual(saved.last?.favoritesDisplayMode, FavoritesDisplayMode.tiles.rawValue)
    }

    func testCloudKitStationRecordDecoderRejectsLegacyInvalidPayloads() throws {
        let valid = station("valid")
        let validRecord = CKRecord(recordType: "Favorite", recordID: CKRecord.ID(recordName: "favorite-valid"))
        validRecord["stationData"] = try JSONEncoder().encode(valid) as NSData
        XCTAssertEqual(CloudKitSyncStore.stationData(from: validRecord)?.id, valid.id)

        let validList = StationList(id: "list-valid", name: "Valid", stations: [valid])
        let validListRecord = CKRecord(recordType: "StationList", recordID: CKRecord.ID(recordName: "station-list-valid"))
        validListRecord["listData"] = try JSONEncoder().encode(validList) as NSData
        XCTAssertEqual(CloudKitSyncStore.stationListData(from: validListRecord)?.id, validList.id)

        let legacyRecord = CKRecord(recordType: "Favorite", recordID: CKRecord.ID(recordName: "favorite-legacy"))
        legacyRecord["stationData"] = Data(#"{"id":"legacy"}"#.utf8) as NSData
        XCTAssertNil(CloudKitSyncStore.stationData(from: legacyRecord))

        let legacyListRecord = CKRecord(recordType: "StationList", recordID: CKRecord.ID(recordName: "station-list-legacy"))
        legacyListRecord["listData"] = Data(#"{"id":"legacy"}"#.utf8) as NSData
        XCTAssertNil(CloudKitSyncStore.stationListData(from: legacyListRecord))
    }

    func testCloudSyncPreferencesSchemaVersionIsExplicit() {
        XCTAssertEqual(CloudSyncPreferencesSchema.currentVersion, 1)
    }

    private func makeDependencies(
        defaults: UserDefaults,
        store: CloudSyncStoring,
        configure shouldConfigure: Bool = true,
        pushDebounceNanoseconds: UInt64 = 750_000_000,
    ) -> TestDependencies {
        let library = Library(defaults: defaults)
        let theme = ThemeController(defaults: defaults)
        let locale = LocaleController(defaults: defaults)
        let sleepTimer = SleepTimer(defaults: defaults)
        let wakeAlarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier())
        let carMode = CarModeController(defaults: defaults)
        let listeningHistory = ListeningHistory(defaults: defaults, recordsURL: temporaryRecordsURL())
        let diagnostics = Diagnostics(defaults: defaults)
        let controller = CloudSyncController(
            defaults: defaults,
            store: store,
            pushDebounceNanoseconds: pushDebounceNanoseconds,
        )
        let dependencies = TestDependencies(
            library: library,
            theme: theme,
            locale: locale,
            sleepTimer: sleepTimer,
            wakeAlarm: wakeAlarm,
            carMode: carMode,
            listeningHistory: listeningHistory,
            diagnostics: diagnostics,
            controller: controller,
        )
        if shouldConfigure {
            configure(dependencies)
        }
        return dependencies
    }

    private func configure(_ dependencies: TestDependencies) {
        dependencies.controller.configure(
            library: dependencies.library,
            theme: dependencies.theme,
            locale: dependencies.locale,
            sleepTimer: dependencies.sleepTimer,
            wakeAlarm: dependencies.wakeAlarm,
            carMode: dependencies.carMode,
            listeningHistory: dependencies.listeningHistory,
            diagnostics: dependencies.diagnostics,
            refreshOnLaunch: false,
        )
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "CloudSyncControllerTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }

    private func temporaryRecordsURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("CloudSyncControllerTests-\(UUID().uuidString).json")
    }

    private func waitForSavedSnapshot(
        in store: FakeCloudSyncStore,
        minimumCount: Int = 1,
    ) async -> CloudSyncSnapshot? {
        for _ in 0..<20 {
            let snapshots = await store.savedSnapshots()
            if snapshots.count >= minimumCount {
                return snapshots.last
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return nil
    }

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
        landingStationListID: String = "",
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
            landingStationListID: landingStationListID,
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
}

private struct TestDependencies {
    let library: Library
    let theme: ThemeController
    let locale: LocaleController
    let sleepTimer: SleepTimer
    let wakeAlarm: WakeAlarm
    let carMode: CarModeController
    let listeningHistory: ListeningHistory
    let diagnostics: Diagnostics
    let controller: CloudSyncController
}

private actor FakeCloudSyncStore: CloudSyncStoring {
    private let snapshot: CloudSyncSnapshot
    private let fetchError: Error?
    private let fetchDelayNanoseconds: UInt64
    private let saveDelayNanoseconds: UInt64
    private var saved: [CloudSyncSnapshot] = []

    init(
        snapshot: CloudSyncSnapshot,
        fetchError: Error? = nil,
        fetchDelayNanoseconds: UInt64 = 0,
        saveDelayNanoseconds: UInt64 = 0,
    ) {
        self.snapshot = snapshot
        self.fetchError = fetchError
        self.fetchDelayNanoseconds = fetchDelayNanoseconds
        self.saveDelayNanoseconds = saveDelayNanoseconds
    }

    func accountStatus() async throws -> CKAccountStatus {
        .available
    }

    func fetchSnapshot() async throws -> CloudSyncSnapshot {
        if fetchDelayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: fetchDelayNanoseconds)
        }
        if let fetchError {
            throw fetchError
        }
        return snapshot
    }

    func save(snapshot: CloudSyncSnapshot) async throws {
        if saveDelayNanoseconds > 0 {
            try? await Task.sleep(nanoseconds: saveDelayNanoseconds)
        }
        saved.append(snapshot)
    }

    func resetAll(resetAt: Date) async throws {
        saved.append(.empty)
    }

    func savedSnapshots() -> [CloudSyncSnapshot] {
        saved
    }
}

private struct NoopWakeNotifier: WakeAlarmNotifying {
    func schedule(station: Station, time: String, firesAt: Date, title: String?) {}
    func cancel() {}
    func authorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void) {
        completion(.authorized)
    }
    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        completion(true)
    }
}
