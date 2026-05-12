import SwiftUI
import UserNotifications
import UIKit

@main
struct rrradioApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var systemColorScheme
    @State private var catalog = Catalog()
    @State private var library = Library()
    @State private var player = AudioPlayer()
    @State private var sleepTimer = SleepTimer()
    @State private var wakeAlarm = WakeAlarm()
    @State private var theme = ThemeController()
    @State private var locale = LocaleController()
    @State private var carMode = CarModeController()
    @State private var listeningHistory = ListeningHistory()
    @State private var diagnostics = Diagnostics.shared
    @State private var cloudSync = CloudSyncController()
    @State private var network = NetworkMonitor()
    @State private var wasOffline = false
    @State private var shouldAutoResumeAfterNetworkRestored = false

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(catalog)
                .environment(library)
                .environment(player)
                .environment(sleepTimer)
                .environment(wakeAlarm)
                .environment(theme)
                .environment(locale)
                .environment(carMode)
                .environment(listeningHistory)
                .environment(diagnostics)
                .environment(cloudSync)
                .environment(network)
                .preferredColorScheme(theme.preferredColorScheme)
                .onAppear {
                    theme.setSystemColorScheme(systemColorScheme)
                    diagnostics.record("app", "appeared")
                    wasOffline = network.snapshot.isOffline
                    player.setListeningHistory(listeningHistory)
                    configureFavoriteRemoteControls()
                    saveCurrentStationAsFavoriteZeroIfNeeded()
                    sleepTimer.onStateChanged = { [sleepTimer, player] in
                        player.setLockScreenSleepTimer(firesAt: sleepTimer.firesAt)
                    }
                    player.setLockScreenSleepTimer(firesAt: sleepTimer.firesAt)
                    cloudSync.configure(
                        library: library,
                        theme: theme,
                        locale: locale,
                        sleepTimer: sleepTimer,
                        wakeAlarm: wakeAlarm,
                        carMode: carMode,
                        listeningHistory: listeningHistory,
                        diagnostics: diagnostics,
                    )
                }
                .onChange(of: systemColorScheme) { _, newColorScheme in
                    theme.setSystemColorScheme(newColorScheme)
                }
                .onChange(of: scenePhase) { _, phase in
                    diagnostics.record("app", "scene phase", details: ["phase": "\(phase)"])
                    if phase == .active {
                        Task { await cloudSync.refreshFromCloud() }
                        Task { await catalog.refreshIfStale() }
                    }
                }
                .onChange(of: player.current?.id) { _, _ in
                    saveCurrentStationAsFavoriteZeroIfNeeded()
                }
                .onChange(of: network.snapshot) { oldSnapshot, newSnapshot in
                    if newSnapshot.isOffline {
                        wasOffline = true
                        shouldAutoResumeAfterNetworkRestored = shouldAutoResumeAfterNetworkRestored || player.shouldAutoResumeAfterConnectivityRestored
                        return
                    }

                    guard oldSnapshot.isOffline || wasOffline else { return }
                    wasOffline = false
                    if shouldAutoResumeAfterNetworkRestored {
                        shouldAutoResumeAfterNetworkRestored = false
                        _ = player.reconnectCurrentAfterConnectivityRestored()
                    }
                }
                .task { await catalog.loadIfNeeded() }
        }
    }

    private func configureFavoriteRemoteControls() {
        player.setFavoriteStationRemoteControls(
            stepHandler: { direction, current in
                library.stationForFavoriteStep(from: current, direction: direction)
            },
            queueInfoProvider: { current in
                library.favoriteQueueInfo(for: current)
            },
        )
    }

    private func saveCurrentStationAsFavoriteZeroIfNeeded() {
        guard let station = player.current else { return }
        library.saveAsFavoriteStationZeroIfNeeded(station)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil,
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        diagnosticRecordAsync("app", "did finish launching")
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
    ) async -> UNNotificationPresentationOptions {
        diagnosticRecordAsync(
            "notification",
            "will present",
            details: ["identifier": notification.request.identifier],
        )
        return [.banner, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
    ) async {
        diagnosticRecordAsync(
            "notification",
            "response received",
            details: [
                "identifier": response.notification.request.identifier,
                "action": response.actionIdentifier,
            ],
        )
    }
}
