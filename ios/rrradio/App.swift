import SwiftUI

@main
struct rrradioApp: App {
    @State private var catalog = Catalog()
    @State private var player = AudioPlayer()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(catalog)
                .environment(player)
                .task { await catalog.loadIfNeeded() }
        }
    }
}
