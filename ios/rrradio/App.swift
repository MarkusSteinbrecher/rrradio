import SwiftUI

@main
struct rrradioApp: App {
    @State private var catalog = Catalog()
    @State private var library = Library()
    @State private var player = AudioPlayer()
    @State private var sleepTimer = SleepTimer()
    @State private var wakeAlarm = WakeAlarm()
    @State private var theme = ThemeController()
    @State private var locale = LocaleController()
    @State private var carMode = CarModeController()
    @State private var listeningHistory = ListeningHistory()

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
                .preferredColorScheme(theme.preferredColorScheme)
                .onAppear {
                    player.setListeningHistory(listeningHistory)
                }
                .task { await catalog.loadIfNeeded() }
        }
    }
}
