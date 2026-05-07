import SwiftUI

struct ContentView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(LocaleController.self) private var locale
    @State private var tab: AppTab = .browse
    @State private var didApplyLandingPreference = false
    @State private var showingLandingNowPlaying = false
    @AppStorage(LandingPage.storageKey) private var landingPageRaw = LandingPage.browse.rawValue
    @AppStorage(LandingPage.stationIDKey) private var landingStationID = ""

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
        .sheet(isPresented: $showingLandingNowPlaying) {
            NowPlayingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
        .onAppear {
            wakeAlarm.activate { station in
                player.play(station)
            }
            applyLandingPreferenceIfReady()
        }
        .onChange(of: catalog.stations.count) { _, _ in
            applyLandingPreferenceIfReady()
        }
    }

    private func applyLandingPreferenceIfReady() {
        guard !didApplyLandingPreference else { return }

        switch LandingPage(rawValue: landingPageRaw) ?? .browse {
        case .browse:
            tab = .browse
            didApplyLandingPreference = true
        case .favorites:
            tab = .library
            didApplyLandingPreference = true
        case .station:
            guard !landingStationID.isEmpty else {
                tab = .browse
                didApplyLandingPreference = true
                return
            }

            if let station = landingStation {
                player.play(station)
                didApplyLandingPreference = true
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    showingLandingNowPlaying = true
                }
            } else if !catalog.stations.isEmpty {
                tab = .browse
                didApplyLandingPreference = true
            }
        }
    }

    private var landingStation: Station? {
        let stations = catalog.browseOrdered + library.favorites + library.recents + library.customStations
        return stations.first { $0.id == landingStationID }
    }
}

enum AppTab {
    case browse
    case library
}

private struct BottomTabBar: View {
    @Environment(LocaleController.self) private var locale
    @Binding var tab: AppTab

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.browse, icon: "globe", title: locale.text(.browse))
            tabButton(.library, icon: "heart", title: locale.text(.library))
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
                        .fill(RrradioTheme.accent)
                        .frame(width: 66, height: 2)
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
        .environment(WakeAlarm())
        .environment(ThemeController())
        .environment(LocaleController())
}
