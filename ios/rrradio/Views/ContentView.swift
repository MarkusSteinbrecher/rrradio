import SwiftUI

struct ContentView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(AudioPlayer.self) private var player
    @State private var tab: AppTab = .browse

    var body: some View {
        StationListView(tab: $tab)
            .background(RrradioTheme.bg.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 0) {
                if player.current != nil {
                    MiniPlayerView()
                        .transition(.move(edge: .bottom))
                }
                BottomTabBar(tab: $tab)
            }
        }
        .animation(.snappy, value: player.current?.id)
    }
}

enum AppTab {
    case browse
    case library
}

private struct BottomTabBar: View {
    @Binding var tab: AppTab

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.browse, icon: "globe", title: "Browse")
            tabButton(.library, icon: "heart", title: "Library")
        }
        .background(RrradioTheme.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func tabButton(_ value: AppTab, icon: String, title: String) -> some View {
        Button {
            tab = value
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .regular))
                Text(title)
                    .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
            }
            .foregroundStyle(tab == value ? RrradioTheme.ink : RrradioTheme.ink3)
            .frame(maxWidth: .infinity)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .overlay(alignment: .top) {
                if tab == value {
                    Rectangle()
                        .fill(RrradioTheme.ink)
                        .frame(width: 24, height: 1)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ContentView()
        .environment(Catalog())
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(SleepTimer())
        .environment(ThemeController())
}
