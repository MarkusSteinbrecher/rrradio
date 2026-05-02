import SwiftUI

struct ContentView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(AudioPlayer.self) private var player

    var body: some View {
        NavigationStack {
            StationListView()
                .navigationTitle("rrradio")
                .navigationBarTitleDisplayMode(.inline)
        }
        .safeAreaInset(edge: .bottom) {
            if player.current != nil {
                MiniPlayerView()
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.snappy, value: player.current?.id)
    }
}

#Preview {
    ContentView()
        .environment(Catalog())
        .environment(AudioPlayer())
}
