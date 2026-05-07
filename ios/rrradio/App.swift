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
                .preferredColorScheme(theme.preferredColorScheme)
                .task { await catalog.loadIfNeeded() }
        }
    }
}
