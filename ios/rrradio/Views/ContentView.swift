import SwiftUI

struct ContentView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(LocaleController.self) private var locale
    @Environment(NetworkMonitor.self) private var network
    @State private var tab: AppTab = .browse
    @State private var searchFocused = false
    @State private var didApplyLandingPreference = false
    @State private var showingLandingNowPlaying = false
    @State private var showingWakePauseWarning = false
    @AppStorage(LandingPage.storageKey) private var landingPageRaw = LandingPage.browse.rawValue
    @AppStorage(LandingPage.stationIDKey) private var landingStationID = ""

    var body: some View {
        StationListView(tab: $tab, searchFocusedExternally: $searchFocused)
            .background(RrradioTheme.bg.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomChrome
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
            playPendingIntentStationIfPossible()
            syncWakeKeepAlive()
        }
        .onChange(of: catalog.stations.count) { _, _ in
            applyLandingPreferenceIfReady()
            playPendingIntentStationIfPossible()
        }
        .onReceive(NotificationCenter.default.publisher(for: .intentPlaybackRequested)) { _ in
            playPendingIntentStationIfPossible()
        }
        .onChange(of: player.state) { oldState, newState in
            if oldState == .playing, newState == .paused, wakeAlarm.shouldShowPauseWarning() {
                showingWakePauseWarning = true
            }
            syncWakeKeepAlive()
        }
        .onChange(of: wakeAlarm.isArmed) { _, _ in
            syncWakeKeepAlive()
        }
        .onChange(of: wakeAlarm.keepAliveEnabled) { _, _ in
            syncWakeKeepAlive()
        }
        .alert(locale.text(.wakePauseWarningTitle), isPresented: $showingWakePauseWarning) {
            Button(locale.text(.ok), role: .cancel) {}
            Button(locale.text(.dontShowAgain)) {
                wakeAlarm.suppressPauseWarning()
            }
        } message: {
            Text(locale.text(.wakePauseWarningMessage))
        }
    }

    @ViewBuilder
    private var bottomChrome: some View {
        if !searchFocused {
            VStack(spacing: 0) {
                if player.current != nil || network.snapshot.isOffline {
                    MiniPlayerView()
                }
                BottomTabBar(tab: $tab)
            }
            .id("bottom-chrome")
            .zIndex(100)
            .transaction { transaction in
                transaction.animation = nil
            }
        }
    }

    private func applyLandingPreferenceIfReady() {
        guard !didApplyLandingPreference else { return }

        switch LandingPage(rawValue: landingPageRaw) ?? .browse {
        case .browse:
            tab = .browse
            didApplyLandingPreference = true
        case .favorites:
            tab = .favorites
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

    private func playPendingIntentStationIfPossible() {
        let stations = catalog.browseOrdered + library.favorites + library.recents + library.customStations
        guard let station = IntentPlaybackRequest.consumePendingStation(from: stations) else { return }
        player.play(station)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            showingLandingNowPlaying = true
        }
    }

    private func syncWakeKeepAlive() {
        if wakeAlarm.isArmed, wakeAlarm.keepAliveEnabled, player.state != .playing {
            _ = player.startWakeKeepAlive()
        } else if !wakeAlarm.isArmed || !wakeAlarm.keepAliveEnabled || player.state == .playing {
            player.stopWakeKeepAlive()
        }
    }
}

enum AppTab {
    case browse
    case favorites
}

private struct BottomTabBar: View {
    @Environment(LocaleController.self) private var locale
    @Binding var tab: AppTab

    var body: some View {
        HStack(spacing: 0) {
            tabButton(.browse, icon: "globe", title: locale.text(.browse))
            tabButton(.favorites, icon: "heart", title: locale.text(.favorites))
        }
        .background(RrradioTheme.bg.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
        .overlay(alignment: .top) {
            HStack(spacing: 0) {
                tabIndicator(.browse)
                tabIndicator(.favorites)
            }
            .frame(height: 2)
        }
    }

    private func tabIndicator(_ value: AppTab) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                if tab == value {
                    Rectangle()
                        .fill(RrradioTheme.accent)
                        .frame(width: proxy.size.width * 0.5, height: 2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity)
    }

    private func tabButton(_ value: AppTab, icon: String, title: String) -> some View {
        let selected = tab == value
        return Button {
            withAnimation(.snappy) {
                tab = value
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 21, weight: selected ? .semibold : .regular))
                Text(title)
                    .font(.system(size: 9.5, weight: selected ? .semibold : .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
            }
            .foregroundStyle(selected ? RrradioTheme.accent : RrradioTheme.ink3)
            .frame(maxWidth: .infinity)
            .padding(.top, 9)
            .padding(.bottom, 0)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
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
        .environment(CloudSyncController())
        .environment(NetworkMonitor(startsAutomatically: false))
}
