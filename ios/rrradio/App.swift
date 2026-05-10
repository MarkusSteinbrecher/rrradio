import SwiftUI
import UserNotifications
import UIKit

@main
struct rrradioApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
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
                .preferredColorScheme(theme.preferredColorScheme)
                .onAppear {
                    diagnostics.record("app", "appeared")
                    player.setListeningHistory(listeningHistory)
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
                .onChange(of: scenePhase) { _, phase in
                    diagnostics.record("app", "scene phase", details: ["phase": "\(phase)"])
                    if phase == .active {
                        Task { await cloudSync.refreshFromCloud() }
                    }
                }
                .task { await catalog.loadIfNeeded() }
        }
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
