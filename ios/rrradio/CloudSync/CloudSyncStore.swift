import CloudKit
import CryptoKit
import Foundation

protocol CloudSyncStoring: Sendable {
    func accountStatus() async throws -> CKAccountStatus
    func fetchSnapshot() async throws -> CloudSyncSnapshot
    func save(snapshot: CloudSyncSnapshot) async throws
    func resetAll(resetAt: Date) async throws
}

enum CloudSyncStoreFactory {
    static func make() -> CloudSyncStoring {
        guard hasCloudKitEntitlement() else {
            return UnavailableCloudSyncStore(reason: "iCloud sync is unavailable in unsigned builds.")
        }
        return CloudKitSyncStore()
    }

    private static func hasCloudKitEntitlement() -> Bool {
        #if targetEnvironment(simulator)
            return false
        #else
            return true
        #endif
    }
}

struct UnavailableCloudSyncStore: CloudSyncStoring {
    let reason: String

    func accountStatus() async throws -> CKAccountStatus {
        throw CloudSyncUnavailableError(reason: reason)
    }

    func fetchSnapshot() async throws -> CloudSyncSnapshot {
        throw CloudSyncUnavailableError(reason: reason)
    }

    func save(snapshot: CloudSyncSnapshot) async throws {
        throw CloudSyncUnavailableError(reason: reason)
    }

    func resetAll(resetAt: Date) async throws {
        throw CloudSyncUnavailableError(reason: reason)
    }
}

struct CloudSyncUnavailableError: LocalizedError {
    let reason: String

    var errorDescription: String? {
        reason
    }
}

struct CloudSyncRecordFetchError: LocalizedError {
    let recordNames: [String]

    var errorDescription: String? {
        "CloudKit did not return every expected rrradio record."
    }
}

enum CloudSyncPreferencesSchema {
    static let currentVersion = 1
}

// CloudKit handle types are immutable references used only through async APIs here,
// but the SDK does not currently annotate them as Sendable.
final class CloudKitSyncStore: CloudSyncStoring, @unchecked Sendable {
    static let containerIdentifier = "iCloud.ios.rrradio.org"

    private enum RecordType {
        static let favorite = "Favorite"
        static let favoritesOrder = "FavoritesOrder"
        static let customStationsIndex = "CustomStationsIndex"
        static let customStation = "CustomStation"
        static let preferences = "Preferences"
        static let syncState = "SyncState"
    }

    private enum RecordName {
        static let favoritesOrder = "favorites-order"
        static let customStationsIndex = "custom-stations-index"
        static let preferences = "preferences"
        static let syncState = "sync-state"
    }

    private let container: CKContainer
    private let database: CKDatabase

    convenience init() {
        self.init(containerIdentifier: CloudKitSyncStore.containerIdentifier)
    }

    convenience init(containerIdentifier: String) {
        self.init(container: CKContainer(identifier: containerIdentifier))
    }

    init(container: CKContainer) {
        self.container = container
        database = container.privateCloudDatabase
    }

    func accountStatus() async throws -> CKAccountStatus {
        try await container.accountStatus()
    }

    func fetchSnapshot() async throws -> CloudSyncSnapshot {
        async let favorites = fetchFavorites()
        async let order = fetchFavoritesOrder()
        async let customStations = fetchCustomStations()
        async let preferences = fetchPreferences()
        async let resetAt = fetchResetAt()

        let remotePreferences = try await preferences
        return CloudSyncSnapshot(
            favorites: try await favorites,
            customStations: try await customStations,
            theme: remotePreferences.theme,
            locale: remotePreferences.locale,
            sleepTimerDefaultMinutes: remotePreferences.sleepTimerDefaultMinutes,
            landingPage: remotePreferences.landingPage,
            landingStationID: remotePreferences.landingStationID,
            favoritesDisplayMode: remotePreferences.favoritesDisplayMode,
            wakeDefaultTime: remotePreferences.wakeDefaultTime,
            wakeNotificationsEnabled: remotePreferences.wakeNotificationsEnabled,
            carModeAutomaticEnabled: remotePreferences.carModeAutomaticEnabled,
            carModeManualEnabled: remotePreferences.carModeManualEnabled,
            listeningHistoryEnabled: remotePreferences.listeningHistoryEnabled,
            listeningHistoryLevel: remotePreferences.listeningHistoryLevel,
            listeningHistoryRetention: remotePreferences.listeningHistoryRetention,
            favoritesOrder: try await order,
            resetAt: try await resetAt,
            hasPreferences: remotePreferences.exists,
        )
    }

    func save(snapshot: CloudSyncSnapshot) async throws {
        var recordsToSave: [CKRecord] = []
        recordsToSave.append(contentsOf: snapshot.favorites.map(makeFavoriteRecord))
        recordsToSave.append(makeFavoritesOrderRecord(snapshot.favoritesOrder))
        recordsToSave.append(contentsOf: snapshot.customStations.map(makeCustomStationRecord))
        recordsToSave.append(makeCustomStationsIndexRecord(snapshot.customStations.map(\.id)))
        recordsToSave.append(makePreferencesRecord(snapshot))

        let existingFavoriteIDs = try await favoriteRecordIDsFromOrder()
        let existingCustomIDs = try await customStationRecordIDsFromIndex()
        let wantedFavoriteIDs = Set(snapshot.favorites.map { recordID(prefix: "favorite", stationID: $0.id) })
        let wantedCustomIDs = Set(snapshot.customStations.map { recordID(prefix: "custom", stationID: $0.id) })
        let staleIDs = existingFavoriteIDs.filter { !wantedFavoriteIDs.contains($0) }
            + existingCustomIDs.filter { !wantedCustomIDs.contains($0) }

        try await modify(recordsToSave: recordsToSave, recordIDsToDelete: staleIDs)
    }

    func resetAll(resetAt: Date) async throws {
        let favoriteIDs = try await favoriteRecordIDsFromOrder()
        let customIDs = try await customStationRecordIDsFromIndex()
        let resetRecord = makeSyncStateRecord(resetAt: resetAt)
        let ids = favoriteIDs
            + customIDs
            + [
                CKRecord.ID(recordName: RecordName.favoritesOrder),
                CKRecord.ID(recordName: RecordName.customStationsIndex),
                CKRecord.ID(recordName: RecordName.preferences),
            ]
        try await modify(recordsToSave: [resetRecord], recordIDsToDelete: ids)
    }

    private func fetchFavorites() async throws -> [Station] {
        try await fetchStations(ids: favoriteRecordIDsFromOrder())
    }

    private func fetchFavoritesOrder() async throws -> [String] {
        do {
            let record = try await database.record(for: CKRecord.ID(recordName: RecordName.favoritesOrder))
            return record["stationIds"] as? [String] ?? []
        } catch let error as CKError where error.code == .unknownItem {
            return []
        }
    }

    private func fetchCustomStations() async throws -> [Station] {
        try await fetchStations(ids: customStationRecordIDsFromIndex())
    }

    private func fetchPreferences() async throws -> (
        theme: String,
        locale: String,
        sleepTimerDefaultMinutes: Int,
        landingPage: String,
        landingStationID: String,
        favoritesDisplayMode: String,
        wakeDefaultTime: String,
        wakeNotificationsEnabled: Bool,
        carModeAutomaticEnabled: Bool,
        carModeManualEnabled: Bool,
        listeningHistoryEnabled: Bool,
        listeningHistoryLevel: String,
        listeningHistoryRetention: String,
        exists: Bool
    ) {
        do {
            let record = try await database.record(for: CKRecord.ID(recordName: RecordName.preferences))
            return (
                record["theme"] as? String ?? ThemeController.Choice.system.rawValue,
                record["locale"] as? String ?? LocaleController.Choice.system.rawValue,
                record["sleepTimerDefaultMinutes"] as? Int ?? SleepTimer.fallbackDefaultMinutes,
                record["landingPage"] as? String ?? LandingPage.browse.rawValue,
                record["landingStationID"] as? String ?? "",
                record["favoritesDisplayMode"] as? String ?? FavoritesDisplayMode.list.rawValue,
                record["wakeDefaultTime"] as? String ?? WakeAlarm.fallbackDefaultTime,
                record["wakeNotificationsEnabled"] as? Bool ?? false,
                record["carModeAutomaticEnabled"] as? Bool ?? true,
                record["carModeManualEnabled"] as? Bool ?? false,
                record["listeningHistoryEnabled"] as? Bool ?? false,
                record["listeningHistoryLevel"] as? String ?? ListeningHistoryLevel.stations.rawValue,
                record["listeningHistoryRetention"] as? String ?? ListeningHistoryRetention.days90.rawValue,
                true
            )
        } catch let error as CKError where error.code == .unknownItem {
            return (
                "",
                "",
                0,
                "",
                "",
                "",
                "",
                false,
                true,
                false,
                false,
                "",
                "",
                false
            )
        }
    }

    private func fetchResetAt() async throws -> Date? {
        do {
            let record = try await database.record(for: CKRecord.ID(recordName: RecordName.syncState))
            return record["resetAt"] as? Date
        } catch let error as CKError where error.code == .unknownItem {
            return nil
        }
    }

    private func favoriteRecordIDsFromOrder() async throws -> [CKRecord.ID] {
        try await fetchFavoritesOrder().map { recordID(prefix: "favorite", stationID: $0) }
    }

    private func customStationRecordIDsFromIndex() async throws -> [CKRecord.ID] {
        let ids = try await fetchCustomStationIds()
        return ids.map { recordID(prefix: "custom", stationID: $0) }
    }

    private func fetchCustomStationIds() async throws -> [String] {
        do {
            let record = try await database.record(for: CKRecord.ID(recordName: RecordName.customStationsIndex))
            return record["stationIds"] as? [String] ?? []
        } catch let error as CKError where error.code == .unknownItem {
            return []
        }
    }

    private func fetchRecords(ids: [CKRecord.ID]) async throws -> [CKRecord] {
        guard !ids.isEmpty else { return [] }
        let result = try await database.records(for: ids)
        var records: [CKRecord] = []
        var failedNames: [String] = []
        for (id, recordResult) in result {
            do {
                records.append(try recordResult.get())
            } catch {
                if Self.isMissingRecordError(error) {
                    continue
                }
                failedNames.append(id.recordName)
            }
        }
        let returnedIDs = Set(result.map(\.key))
        failedNames.append(contentsOf: ids.filter { !returnedIDs.contains($0) }.map(\.recordName))
        guard failedNames.isEmpty else {
            throw CloudSyncRecordFetchError(recordNames: failedNames)
        }
        return records
    }

    private func fetchStations(ids: [CKRecord.ID]) async throws -> [Station] {
        let records = try await fetchRecords(ids: ids)
        return records.compactMap(Self.stationData)
    }

    private func modify(recordsToSave: [CKRecord], recordIDsToDelete: [CKRecord.ID]) async throws {
        _ = try await database.modifyRecords(
            saving: recordsToSave,
            deleting: recordIDsToDelete,
            savePolicy: .changedKeys,
            atomically: false,
        )
    }

    private func makeFavoriteRecord(_ station: Station) -> CKRecord {
        let record = CKRecord(recordType: RecordType.favorite, recordID: recordID(prefix: "favorite", stationID: station.id))
        record["stationId"] = station.id
        record["stationData"] = encodedStation(station)
        record["addedAt"] = Date()
        return record
    }

    private func makeFavoritesOrderRecord(_ stationIds: [String]) -> CKRecord {
        let record = CKRecord(recordType: RecordType.favoritesOrder, recordID: CKRecord.ID(recordName: RecordName.favoritesOrder))
        record["stationIds"] = stationIds as NSArray
        return record
    }

    private func makeCustomStationsIndexRecord(_ stationIds: [String]) -> CKRecord {
        let record = CKRecord(recordType: RecordType.customStationsIndex, recordID: CKRecord.ID(recordName: RecordName.customStationsIndex))
        record["stationIds"] = stationIds as NSArray
        return record
    }

    private func makeCustomStationRecord(_ station: Station) -> CKRecord {
        let record = CKRecord(recordType: RecordType.customStation, recordID: recordID(prefix: "custom", stationID: station.id))
        record["stationId"] = station.id
        record["stationData"] = encodedStation(station)
        return record
    }

    private func makePreferencesRecord(_ snapshot: CloudSyncSnapshot) -> CKRecord {
        let record = CKRecord(recordType: RecordType.preferences, recordID: CKRecord.ID(recordName: RecordName.preferences))
        record["schemaVersion"] = CloudSyncPreferencesSchema.currentVersion
        record["updatedAt"] = Date()
        record["theme"] = snapshot.theme
        record["locale"] = snapshot.locale
        record["sleepTimerDefaultMinutes"] = snapshot.sleepTimerDefaultMinutes
        record["landingPage"] = snapshot.landingPage
        record["landingStationID"] = snapshot.landingStationID
        record["favoritesDisplayMode"] = snapshot.favoritesDisplayMode
        record["wakeDefaultTime"] = snapshot.wakeDefaultTime
        record["wakeNotificationsEnabled"] = snapshot.wakeNotificationsEnabled
        record["carModeAutomaticEnabled"] = snapshot.carModeAutomaticEnabled
        record["carModeManualEnabled"] = snapshot.carModeManualEnabled
        record["listeningHistoryEnabled"] = snapshot.listeningHistoryEnabled
        record["listeningHistoryLevel"] = snapshot.listeningHistoryLevel
        record["listeningHistoryRetention"] = snapshot.listeningHistoryRetention
        return record
    }

    private func makeSyncStateRecord(resetAt: Date) -> CKRecord {
        let record = CKRecord(recordType: RecordType.syncState, recordID: CKRecord.ID(recordName: RecordName.syncState))
        record["resetAt"] = resetAt
        return record
    }

    private func encodedStation(_ station: Station) -> NSData? {
        guard let data = try? JSONEncoder().encode(station) else { return nil }
        return data as NSData
    }

    static func stationData(from record: CKRecord) -> Station? {
        let data = (record["stationData"] as? Data) ?? (record["stationData"] as? NSData).map { Data(referencing: $0) }
        guard let data else { return nil }
        return try? JSONDecoder().decode(Station.self, from: data)
    }

    private func recordID(prefix: String, stationID: String) -> CKRecord.ID {
        let digest = SHA256.hash(data: Data(stationID.utf8))
        let hash = digest.map { String(format: "%02x", $0) }.joined()
        return CKRecord.ID(recordName: "\(prefix)-\(hash)")
    }

    private static func isMissingRecordError(_ error: Error) -> Bool {
        guard let cloudError = error as? CKError else { return false }
        return cloudError.code == .unknownItem
    }
}
