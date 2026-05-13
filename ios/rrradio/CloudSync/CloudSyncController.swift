import CloudKit
import Foundation
import Observation
import UIKit

@Observable
@MainActor
final class CloudSyncController {
    enum Availability: Equatable {
        case checking
        case available
        case unavailable(String)
    }

    struct SnapshotSummary: Equatable {
        let favorites: Int
        let customStations: Int
        let hasPreferences: Bool
    }

    enum DiagnosticState: Equatable {
        case idle
        case checking
        case unavailable(String)
        case emptyRemote
        case restored(SnapshotSummary)
        case synced(SnapshotSummary)
        case pushed(SnapshotSummary)
        case resetApplied
        case removedCloudData
        case failed(String)
    }

    static let enabledKey = "rrradio.icloudSync.enabled.v1"
    private static let resetAcknowledgedAtKey = "rrradio.icloudSync.resetAcknowledgedAt.v1"

    private let defaults: UserDefaults
    private let store: CloudSyncStoring
    private weak var library: Library?
    private weak var theme: ThemeController?
    private weak var locale: LocaleController?
    private weak var sleepTimer: SleepTimer?
    private weak var wakeAlarm: WakeAlarm?
    private weak var carMode: CarModeController?
    private weak var listeningHistory: ListeningHistory?
    private weak var diagnostics: Diagnostics?
    private var configured = false
    private var applyingRemote = false
    private var pendingPushTask: Task<Void, Never>?

    private(set) var availability: Availability = .checking
    private(set) var isSyncing = false
    private(set) var lastSync: Date?
    private(set) var lastError: String?
    private(set) var diagnosticState: DiagnosticState = .idle
    var isEnabled: Bool

    init(defaults: UserDefaults = .standard, store: CloudSyncStoring = CloudSyncStoreFactory.make()) {
        self.defaults = defaults
        if defaults.object(forKey: Self.enabledKey) == nil {
            defaults.set(true, forKey: Self.enabledKey)
        }
        isEnabled = defaults.bool(forKey: Self.enabledKey)
        self.store = store
    }

    func configure(
        library: Library,
        theme: ThemeController,
        locale: LocaleController,
        sleepTimer: SleepTimer,
        wakeAlarm: WakeAlarm,
        carMode: CarModeController,
        listeningHistory: ListeningHistory,
        diagnostics: Diagnostics,
        refreshOnLaunch: Bool = true,
    ) {
        guard !configured else { return }
        configured = true
        self.library = library
        self.theme = theme
        self.locale = locale
        self.sleepTimer = sleepTimer
        self.wakeAlarm = wakeAlarm
        self.carMode = carMode
        self.listeningHistory = listeningHistory
        self.diagnostics = diagnostics

        library.onChange = { [weak self] change in
            guard change != .recents else { return }
            Task { @MainActor in self?.schedulePush() }
        }
        theme.onChange = { [weak self] in
            Task { @MainActor in self?.schedulePush() }
        }
        locale.onChange = { [weak self] in
            Task { @MainActor in self?.schedulePush() }
        }
        sleepTimer.onDefaultChanged = { [weak self] in
            Task { @MainActor in self?.schedulePush() }
        }
        wakeAlarm.onPreferencesChanged = { [weak self] in
            Task { @MainActor in self?.schedulePush() }
        }
        carMode.onChange = { [weak self] in
            Task { @MainActor in self?.schedulePush() }
        }
        listeningHistory.onPreferencesChanged = { [weak self] in
            Task { @MainActor in self?.schedulePush() }
        }

        if refreshOnLaunch {
            Task { await refreshFromCloud() }
        }
    }

    func noteSettingsChanged() {
        schedulePush()
    }

    func setEnabled(_ enabled: Bool) {
        isEnabled = enabled
        defaults.set(enabled, forKey: Self.enabledKey)
        diagnostics?.record("icloud", enabled ? "enabled" : "disabled")
        if enabled {
            Task { await refreshFromCloud() }
        } else {
            let message = "iCloud sync is off for rrradio."
            availability = .unavailable(message)
            diagnosticState = .unavailable(message)
        }
    }

    func refreshFromCloud() async {
        guard isEnabled else {
            let message = "iCloud sync is off for rrradio."
            availability = .unavailable(message)
            diagnosticState = .unavailable(message)
            return
        }
        guard !isSyncing else { return }
        isSyncing = true
        diagnosticState = .checking
        defer { isSyncing = false }

        do {
            try await updateAvailability()
        } catch {
            lastError = sanitized(error)
            let message = lastError ?? "iCloud sync is unavailable."
            availability = .unavailable(message)
            diagnosticState = .unavailable(message)
            diagnostics?.record("icloud", "availability failed", details: ["error": message])
            return
        }

        guard availability == .available else {
            diagnosticState = .unavailable(unavailableAvailabilityMessage)
            return
        }

        do {
            let local = localSnapshot()
            let remote = try await store.fetchSnapshot()
            if let resetAt = remote.resetAt, shouldApplyReset(resetAt) {
                applyingRemote = true
                apply(snapshot: .empty)
                applyingRemote = false
                acknowledgeReset(resetAt)
                lastSync = Date()
                lastError = nil
                diagnosticState = .resetApplied
                diagnostics?.record("icloud", "applied reset")
                return
            }
            if !remote.hasCloudData, !local.hasLocalUserPayload {
                lastSync = Date()
                lastError = nil
                diagnosticState = .emptyRemote
                diagnostics?.record("icloud", "empty remote")
                return
            }
            let merged = CloudSyncMerge.merged(local: local, remote: remote)
            applyingRemote = true
            apply(snapshot: merged)
            applyingRemote = false
            try await store.save(snapshot: localSnapshot())
            lastSync = Date()
            lastError = nil
            let summary = Self.summary(for: merged)
            diagnosticState = local.hasLocalUserPayload ? .synced(summary) : .restored(summary)
            diagnostics?.record("icloud", local.hasLocalUserPayload ? "synced" : "restored")
        } catch {
            applyingRemote = false
            lastError = sanitized(error)
            diagnosticState = .failed(lastError ?? "iCloud sync failed.")
            diagnostics?.record("icloud", "sync failed", details: ["error": lastError ?? "unknown"])
        }
    }

    func removeAllCloudData() async {
        guard isEnabled else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            let resetAt = Date()
            try await store.resetAll(resetAt: resetAt)
            applyingRemote = true
            apply(snapshot: .empty)
            applyingRemote = false
            acknowledgeReset(resetAt)
            lastSync = Date()
            lastError = nil
            diagnosticState = .removedCloudData
            diagnostics?.record("icloud", "removed cloud data")
        } catch {
            lastError = sanitized(error)
            diagnosticState = .failed(lastError ?? "iCloud remove failed.")
            diagnostics?.record("icloud", "remove failed", details: ["error": lastError ?? "unknown"])
        }
    }

    func openICloudSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func updateAvailability() async throws {
        let status = try await store.accountStatus()
        switch status {
        case .available:
            availability = .available
        case .noAccount:
            availability = .unavailable("Sign in to iCloud in Settings to sync favorites across devices.")
        case .restricted:
            availability = .unavailable("iCloud is restricted on this device.")
        case .couldNotDetermine:
            availability = .unavailable("iCloud status could not be determined.")
        case .temporarilyUnavailable:
            availability = .unavailable("iCloud is temporarily unavailable.")
        @unknown default:
            availability = .unavailable("iCloud sync is unavailable.")
        }
    }

    private var unavailableAvailabilityMessage: String {
        if case let .unavailable(message) = availability {
            return message
        }
        return "iCloud sync is unavailable."
    }

    private static func summary(for snapshot: CloudSyncSnapshot) -> SnapshotSummary {
        SnapshotSummary(
            favorites: snapshot.favorites.count,
            customStations: snapshot.customStations.count,
            hasPreferences: snapshot.hasPreferences,
        )
    }

    private func schedulePush() {
        guard !applyingRemote, isEnabled else { return }
        pendingPushTask?.cancel()
        pendingPushTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 750_000_000)
            guard !Task.isCancelled else { return }
            await self?.pushLocalSnapshot()
        }
    }

    private func pushLocalSnapshot() async {
        guard isEnabled, !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            try await updateAvailability()
            guard availability == .available else {
                diagnosticState = .unavailable(unavailableAvailabilityMessage)
                return
            }
            let snapshot = localSnapshot()
            try await store.save(snapshot: snapshot)
            lastSync = Date()
            lastError = nil
            diagnosticState = .pushed(Self.summary(for: snapshot))
            diagnostics?.record("icloud", "pushed")
        } catch {
            lastError = sanitized(error)
            diagnosticState = .failed(lastError ?? "iCloud push failed.")
            diagnostics?.record("icloud", "push failed", details: ["error": lastError ?? "unknown"])
        }
    }

    private func localSnapshot() -> CloudSyncSnapshot {
        CloudSyncSnapshot(
            favorites: library?.favorites ?? [],
            customStations: library?.customStations ?? [],
            theme: theme?.choice.rawValue ?? ThemeController.Choice.system.rawValue,
            locale: locale?.choice.rawValue ?? LocaleController.Choice.system.rawValue,
            sleepTimerDefaultMinutes: sleepTimer?.defaultMinutes ?? SleepTimer.fallbackDefaultMinutes,
            landingPage: defaults.string(forKey: LandingPage.storageKey) ?? LandingPage.browse.rawValue,
            landingStationID: defaults.string(forKey: LandingPage.stationIDKey) ?? "",
            favoritesDisplayMode: defaults.string(forKey: FavoritesDisplayMode.storageKey) ?? FavoritesDisplayMode.list.rawValue,
            wakeDefaultTime: defaults.string(forKey: WakeAlarm.defaultTimeKey) ?? WakeAlarm.fallbackDefaultTime,
            wakeNotificationsEnabled: wakeAlarm?.notificationsEnabled ?? defaults.bool(forKey: WakeAlarm.notificationsEnabledKey),
            carModeAutomaticEnabled: carMode?.automaticEnabled ?? true,
            carModeManualEnabled: carMode?.manualEnabled ?? false,
            listeningHistoryEnabled: listeningHistory?.isEnabled ?? defaults.bool(forKey: ListeningHistory.enabledKey),
            listeningHistoryLevel: listeningHistory?.level.rawValue ?? ListeningHistoryLevel.stations.rawValue,
            listeningHistoryRetention: listeningHistory?.retention.rawValue ?? ListeningHistoryRetention.days90.rawValue,
            favoritesOrder: library?.favorites.map(\.id) ?? [],
            resetAt: nil,
            hasPreferences: true,
        )
    }

    private func apply(snapshot: CloudSyncSnapshot) {
        library?.applyCloudSync(favorites: snapshot.favorites, customStations: snapshot.customStations)
        if let choice = ThemeController.Choice(rawValue: snapshot.theme) {
            theme?.applyCloudSync(choice)
        }
        if let choice = LocaleController.Choice(rawValue: snapshot.locale) {
            locale?.applyCloudSync(choice)
        }
        sleepTimer?.applyCloudSyncDefaultMinutes(snapshot.sleepTimerDefaultMinutes)
        if LandingPage(rawValue: snapshot.landingPage) != nil {
            defaults.set(snapshot.landingPage, forKey: LandingPage.storageKey)
        }
        defaults.set(snapshot.landingStationID, forKey: LandingPage.stationIDKey)
        if FavoritesDisplayMode(rawValue: snapshot.favoritesDisplayMode) != nil {
            defaults.set(snapshot.favoritesDisplayMode, forKey: FavoritesDisplayMode.storageKey)
        }
        wakeAlarm?.applyCloudSyncPreferences(
            defaultTime: snapshot.wakeDefaultTime,
            notificationsEnabled: snapshot.wakeNotificationsEnabled,
        )
        carMode?.applyCloudSync(
            automaticEnabled: snapshot.carModeAutomaticEnabled,
            manualEnabled: snapshot.carModeManualEnabled,
        )
        if let level = ListeningHistoryLevel(rawValue: snapshot.listeningHistoryLevel),
           let retention = ListeningHistoryRetention(rawValue: snapshot.listeningHistoryRetention) {
            listeningHistory?.applyCloudSyncPreferences(
                enabled: snapshot.listeningHistoryEnabled,
                level: level,
                retention: retention,
            )
        }
    }

    private func sanitized(_ error: Error) -> String {
        if error is CloudSyncRecordFetchError {
            return "iCloud schema or record fetch failed. Local data was not changed."
        }
        if let cloudError = error as? CKError {
            if let serverMessage = cloudError.userInfo["ServerErrorDescription"] as? String,
               !serverMessage.isEmpty {
                return "iCloud error \(cloudError.code.rawValue): \(serverMessage)"
            }
            switch cloudError.code {
            case .notAuthenticated:
                return "iCloud account is not authenticated."
            case .networkUnavailable, .networkFailure:
                return "Network is unavailable."
            case .quotaExceeded:
                return "iCloud storage quota is full."
            case .limitExceeded, .requestRateLimited:
                return "iCloud is rate limiting sync."
            case .unknownItem:
                return "iCloud has no rrradio sync records yet."
            default:
                return "iCloud error: \(cloudError.code.rawValue)"
            }
        }
        if let unavailable = error as? CloudSyncUnavailableError {
            return unavailable.reason
        }
        return "iCloud sync failed."
    }

    private func shouldApplyReset(_ resetAt: Date) -> Bool {
        guard let acknowledgedAt = defaults.object(forKey: Self.resetAcknowledgedAtKey) as? Date else {
            return true
        }
        return resetAt > acknowledgedAt
    }

    private func acknowledgeReset(_ resetAt: Date) {
        defaults.set(resetAt, forKey: Self.resetAcknowledgedAtKey)
    }
}
