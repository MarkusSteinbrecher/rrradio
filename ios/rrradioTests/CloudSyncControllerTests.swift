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
        let remote = snapshot(
            favorites: [favoriteA, favoriteB],
            customStations: [custom],
            theme: ThemeController.Choice.dark.rawValue,
            locale: LocaleController.Choice.german.rawValue,
            sleepTimerDefaultMinutes: 60,
            landingPage: LandingPage.favorites.rawValue,
            landingStationID: favoriteB.id,
            favoritesDisplayMode: FavoritesDisplayMode.tiles.rawValue,
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

        XCTAssertEqual(dependencies.library.favorites.map(\.id), [favoriteB.id, favoriteA.id])
        XCTAssertEqual(dependencies.library.customStations.map(\.id), [custom.id])
        XCTAssertEqual(dependencies.theme.choice, .dark)
        XCTAssertEqual(dependencies.locale.choice, .german)
        XCTAssertEqual(dependencies.sleepTimer.defaultMinutes, 60)
        XCTAssertEqual(defaults.string(forKey: LandingPage.storageKey), LandingPage.favorites.rawValue)
        XCTAssertEqual(defaults.string(forKey: LandingPage.stationIDKey), favoriteB.id)
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.storageKey), FavoritesDisplayMode.tiles.rawValue)
        XCTAssertEqual(dependencies.wakeAlarm.time, "06:45")
        XCTAssertFalse(dependencies.wakeAlarm.notificationsEnabled)
        XCTAssertFalse(dependencies.carMode.automaticEnabled)
        XCTAssertTrue(dependencies.carMode.manualEnabled)
        XCTAssertTrue(dependencies.listeningHistory.isEnabled)
        XCTAssertEqual(dependencies.listeningHistory.level, .tracks)
        XCTAssertEqual(dependencies.listeningHistory.retention, .forever)
        XCTAssertEqual(
            dependencies.controller.diagnosticState,
            .restored(.init(favorites: 2, customStations: 1, hasPreferences: true)),
        )

        let saved = await store.savedSnapshots()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.favorites.map(\.id), [favoriteB.id, favoriteA.id])
        XCTAssertEqual(saved.first?.customStations.map(\.id), [custom.id])
        XCTAssertEqual(saved.first?.favoritesDisplayMode, FavoritesDisplayMode.tiles.rawValue)
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
        defaults.set(LocaleController.Choice.german.rawValue, forKey: "rrradio.locale")
        defaults.set(FavoritesDisplayMode.app.rawValue, forKey: FavoritesDisplayMode.storageKey)
        defaults.set(true, forKey: ListeningHistory.enabledKey)
        defaults.set(ListeningHistoryLevel.tracks.rawValue, forKey: ListeningHistoryLevel.storageKey)
        defaults.set(ListeningHistoryRetention.forever.rawValue, forKey: ListeningHistoryRetention.storageKey)
        let store = FakeCloudSyncStore(
            snapshot: snapshot(
                theme: "future-theme",
                locale: "future-locale",
                favoritesDisplayMode: "future-display",
                listeningHistoryLevel: "future-level",
                listeningHistoryRetention: "future-retention",
            ),
        )
        let dependencies = makeDependencies(defaults: defaults, store: store)

        await dependencies.controller.refreshFromCloud()

        XCTAssertEqual(dependencies.theme.choice, .dark)
        XCTAssertEqual(dependencies.locale.choice, .german)
        XCTAssertEqual(defaults.string(forKey: FavoritesDisplayMode.storageKey), FavoritesDisplayMode.app.rawValue)
        XCTAssertTrue(dependencies.listeningHistory.isEnabled)
        XCTAssertEqual(dependencies.listeningHistory.level, .tracks)
        XCTAssertEqual(dependencies.listeningHistory.retention, .forever)
    }

    func testCloudKitStationRecordDecoderRejectsLegacyInvalidPayloads() throws {
        let valid = station("valid")
        let validRecord = CKRecord(recordType: "Favorite", recordID: CKRecord.ID(recordName: "favorite-valid"))
        validRecord["stationData"] = try JSONEncoder().encode(valid) as NSData
        XCTAssertEqual(CloudKitSyncStore.stationData(from: validRecord)?.id, valid.id)

        let legacyRecord = CKRecord(recordType: "Favorite", recordID: CKRecord.ID(recordName: "favorite-legacy"))
        legacyRecord["stationData"] = Data(#"{"id":"legacy"}"#.utf8) as NSData
        XCTAssertNil(CloudKitSyncStore.stationData(from: legacyRecord))
    }

    func testCloudSyncPreferencesSchemaVersionIsExplicit() {
        XCTAssertEqual(CloudSyncPreferencesSchema.currentVersion, 1)
    }

    private func makeDependencies(
        defaults: UserDefaults,
        store: CloudSyncStoring,
        configure shouldConfigure: Bool = true,
    ) -> TestDependencies {
        let library = Library(defaults: defaults)
        let theme = ThemeController(defaults: defaults)
        let locale = LocaleController(defaults: defaults)
        let sleepTimer = SleepTimer(defaults: defaults)
        let wakeAlarm = WakeAlarm(defaults: defaults, notifier: NoopWakeNotifier())
        let carMode = CarModeController(defaults: defaults)
        let listeningHistory = ListeningHistory(defaults: defaults, recordsURL: temporaryRecordsURL())
        let diagnostics = Diagnostics(defaults: defaults)
        let controller = CloudSyncController(defaults: defaults, store: store)
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
    private var saved: [CloudSyncSnapshot] = []

    init(snapshot: CloudSyncSnapshot, fetchError: Error? = nil) {
        self.snapshot = snapshot
        self.fetchError = fetchError
    }

    func accountStatus() async throws -> CKAccountStatus {
        .available
    }

    func fetchSnapshot() async throws -> CloudSyncSnapshot {
        if let fetchError {
            throw fetchError
        }
        return snapshot
    }

    func save(snapshot: CloudSyncSnapshot) async throws {
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
    func schedule(station: Station, time: String, firesAt: Date) {}
    func cancel() {}
    func authorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void) {
        completion(.authorized)
    }
    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        completion(true)
    }
}
