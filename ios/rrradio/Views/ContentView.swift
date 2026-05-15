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
    @State private var browseStationListSelectionActive = false
    @State private var rootSwipeAxis: RootSwipeAxis?
    @State private var rootSwipeDragOffset: CGFloat = 0
    @State private var rootSwipeSettlingTarget: AppTab?
    @AppStorage(LandingPage.storageKey) private var landingPageRaw = LandingPage.browse.rawValue
    @AppStorage(LandingPage.stationIDKey) private var landingStationID = ""
    @AppStorage(FavoritesDisplayMode.storageKey) private var favoritesDisplayModeRaw = FavoritesDisplayMode.list.rawValue
    @AppStorage(FavoritesDisplayMode.orderStorageKey) private var favoritesDisplayModeOrderRaw = FavoritesDisplayMode.defaultRawValue
    @AppStorage(FavoritesDisplayMode.visibleStorageKey) private var favoritesDisplayModeVisibleRaw = FavoritesDisplayMode.defaultRawValue

    private let rootSwipeThreshold: CGFloat = 58
    private let rootSwipeAxisLockThreshold: CGFloat = 12
    private let rootSwipeAxisLockRatio: CGFloat = 1.15
    private let rootSwipeDirectionTolerance: CGFloat = 0.55
    private let rootSwipeCompletionDuration: TimeInterval = 0.24

    private enum RootSwipeAxis {
        case horizontal
        case vertical
    }

    var body: some View {
        rootPages
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

    private var rootPages: some View {
        GeometryReader { proxy in
            let pageWidth = max(proxy.size.width, 1)
            let activeOffset = constrainedRootSwipeOffset(rootSwipeDragOffset, pageWidth: pageWidth)
            ZStack {
                ForEach(AppTab.allCases, id: \.self) { pageTab in
                    stationPage(
                        for: pageTab,
                        isActive: tab == pageTab && rootSwipeSettlingTarget == nil,
                        horizontalSwipeLocked: isHorizontalRootSwipeLocked,
                    )
                        .frame(width: pageWidth, height: proxy.size.height)
                        .offset(x: rootPageOffset(for: pageTab, activeOffset: activeOffset, pageWidth: pageWidth))
                        .allowsHitTesting(tab == pageTab && rootSwipeSettlingTarget == nil)
                        .zIndex(rootPageZIndex(for: pageTab))
                }
            }
            .frame(width: pageWidth, height: proxy.size.height)
            .clipped()
            .contentShape(Rectangle())
            .simultaneousGesture(rootSwipeGesture(pageWidth: pageWidth), including: rootSwipeGestureMask)
        }
    }

    private func stationPage(
        for pageTab: AppTab,
        isActive: Bool,
        horizontalSwipeLocked: Bool,
    ) -> some View {
        StationListView(
            tab: $tab,
            searchFocusedExternally: isActive ? $searchFocused : .constant(false),
            browseStationListSelectionActiveExternally: pageTab == .browse ? $browseStationListSelectionActive : .constant(false),
            fixedTab: pageTab,
            horizontalSwipeLockedExternally: horizontalSwipeLocked,
        )
        .id(pageTab)
    }

    private func rootSwipeGesture(pageWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 16, coordinateSpace: .local)
            .onChanged { value in
                updateRootSwipeOffset(value, pageWidth: pageWidth)
            }
            .onEnded { value in
                handleRootSwipe(value, pageWidth: pageWidth)
            }
    }

    private func updateRootSwipeOffset(_ value: DragGesture.Value, pageWidth: CGFloat) {
        guard canUseRootSwipe else {
            resetRootSwipeTracking()
            return
        }

        let horizontal = value.translation.width
        let vertical = value.translation.height
        updateRootSwipeAxis(horizontal: horizontal, vertical: vertical)
        guard rootSwipeAxis == .horizontal else {
            rootSwipeDragOffset = 0
            return
        }
        rootSwipeDragOffset = constrainedRootSwipeOffset(horizontal, pageWidth: pageWidth)
    }

    private func handleRootSwipe(_ value: DragGesture.Value, pageWidth: CGFloat) {
        guard canUseRootSwipe else {
            resetRootSwipeTracking()
            return
        }

        let horizontal = value.translation.width
        let vertical = value.translation.height
        updateRootSwipeAxis(horizontal: horizontal, vertical: vertical)
        guard rootSwipeAxis == .horizontal,
              isRootSwipeDirection(horizontal: horizontal, vertical: vertical) else {
            settleRootSwipe(to: nil, pageWidth: pageWidth)
            return
        }

        let offset = constrainedRootSwipeOffset(horizontal, pageWidth: pageWidth)
        let predictedOffset = constrainedRootSwipeOffset(value.predictedEndTranslation.width, pageWidth: pageWidth)
        let target = shouldCompleteRootSwipe(offset: offset, predictedOffset: predictedOffset, pageWidth: pageWidth)
            ? rootSwipeTarget(for: offset)
            : nil
        settleRootSwipe(to: target, pageWidth: pageWidth)
    }

    private var canUseRootSwipe: Bool {
        !searchFocused
            && rootSwipeSettlingTarget == nil
            && rootSwipeTargetIsAvailable
    }

    private var rootSwipeTargetIsAvailable: Bool {
        switch tab {
        case .stationLists, .browse:
            true
        case .favorites:
            previousFavoritesDisplayMode == nil
        }
    }

    private var rootSwipeGestureMask: GestureMask {
        canUseRootSwipe ? .all : .none
    }

    private var isHorizontalRootSwipeLocked: Bool {
        canUseRootSwipe && rootSwipeAxis == .horizontal
    }

    private var currentFavoritesDisplayMode: FavoritesDisplayMode {
        FavoritesDisplayMode.normalizedSelection(
            rawValue: favoritesDisplayModeRaw,
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
    }

    private var previousFavoritesDisplayMode: FavoritesDisplayMode? {
        FavoritesDisplayMode.adjacentMode(
            to: currentFavoritesDisplayMode,
            direction: -1,
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
    }

    private func updateRootSwipeAxis(horizontal: CGFloat, vertical: CGFloat) {
        guard rootSwipeAxis == nil else { return }

        let absHorizontal = abs(horizontal)
        let absVertical = abs(vertical)
        guard max(absHorizontal, absVertical) >= rootSwipeAxisLockThreshold else { return }

        if absHorizontal > absVertical * rootSwipeAxisLockRatio {
            rootSwipeAxis = .horizontal
        } else if absVertical > absHorizontal * rootSwipeAxisLockRatio {
            rootSwipeAxis = .vertical
        }
    }

    private func isRootSwipeDirection(horizontal: CGFloat, vertical: CGFloat) -> Bool {
        abs(horizontal) > abs(vertical) * rootSwipeDirectionTolerance
    }

    private func constrainedRootSwipeOffset(_ horizontal: CGFloat, pageWidth: CGFloat) -> CGFloat {
        let width = max(pageWidth, 1)
        guard rootSwipeTarget(for: horizontal) != nil else { return 0 }
        if horizontal < 0 {
            return max(horizontal, -width)
        } else if horizontal > 0 {
            return min(horizontal, width)
        }
        return 0
    }

    private func rootSwipeTarget(for offset: CGFloat) -> AppTab? {
        guard offset != 0 else { return nil }
        return offset < 0 ? tab.next : tab.previous
    }

    private func shouldCompleteRootSwipe(offset: CGFloat, predictedOffset: CGFloat, pageWidth: CGFloat) -> Bool {
        let width = max(pageWidth, 1)
        let distanceThreshold = max(rootSwipeThreshold, width * 0.28)
        let predictedThreshold = width * 0.42
        return abs(offset) >= distanceThreshold || abs(predictedOffset) >= predictedThreshold
    }

    private func rootPageOffset(for pageTab: AppTab, activeOffset: CGFloat, pageWidth: CGFloat) -> CGFloat {
        let width = max(pageWidth, 1)
        return CGFloat(pageTab.navigationIndex - tab.navigationIndex) * width + activeOffset
    }

    private func rootPageZIndex(for pageTab: AppTab) -> Double {
        if rootSwipeSettlingTarget == pageTab { return 2 }
        return tab == pageTab ? 1 : 0
    }

    private func settleRootSwipe(to target: AppTab?, pageWidth: CGFloat) {
        rootSwipeAxis = nil
        guard let target else {
            withAnimation(.snappy(duration: rootSwipeCompletionDuration)) {
                rootSwipeDragOffset = 0
            }
            return
        }

        let finalOffset = CGFloat(tab.navigationIndex - target.navigationIndex) * max(pageWidth, 1)
        rootSwipeSettlingTarget = target
        withAnimation(.snappy(duration: rootSwipeCompletionDuration)) {
            rootSwipeDragOffset = finalOffset
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + rootSwipeCompletionDuration) {
            guard rootSwipeSettlingTarget == target else { return }
            var transaction = Transaction()
            transaction.animation = nil
            withTransaction(transaction) {
                tab = target
                rootSwipeDragOffset = 0
                rootSwipeSettlingTarget = nil
            }
        }
    }

    private func resetRootSwipeTracking() {
        rootSwipeAxis = nil
        rootSwipeDragOffset = 0
        rootSwipeSettlingTarget = nil
    }

    @ViewBuilder
    private var bottomChrome: some View {
        if !searchFocused {
            VStack(spacing: 0) {
                if !browseStationListSelectionActive, player.current != nil || network.snapshot.isOffline {
                    MiniPlayerView()
                }
                BottomTabBar(tab: $tab)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
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

enum AppTab: CaseIterable, Hashable {
    case stationLists
    case browse
    case favorites

    var navigationIndex: Int {
        switch self {
        case .stationLists: 0
        case .browse: 1
        case .favorites: 2
        }
    }

    var previous: AppTab? {
        AppTab.allCases.last { $0.navigationIndex < navigationIndex }
    }

    var next: AppTab? {
        AppTab.allCases.first { $0.navigationIndex > navigationIndex }
    }
}

private struct BottomTabBar: View {
    @Environment(ThemeController.self) private var theme
    @Environment(LocaleController.self) private var locale
    @Binding var tab: AppTab
    private let tabBarHeight: CGFloat = 54

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases, id: \.self) { value in
                tabButton(value, icon: icon(for: value), title: title(for: value))
            }
        }
        .frame(height: tabBarHeight, alignment: .top)
        .background(RrradioTheme.bg.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
        .overlay(alignment: .top) {
            HStack(spacing: 0) {
                ForEach(AppTab.allCases, id: \.self) { value in
                    tabIndicator(value)
                }
            }
            .frame(height: 2)
        }
    }

    private func icon(for value: AppTab) -> String {
        switch value {
        case .stationLists: "list.bullet.rectangle"
        case .browse: "globe"
        case .favorites: "heart"
        }
    }

    private func title(for value: AppTab) -> String {
        switch value {
        case .stationLists: locale.text(.stationListsNav)
        case .browse: locale.text(.browse)
        case .favorites: locale.text(.favorites)
        }
    }

    private func tabIndicator(_ value: AppTab) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                if tab == value {
                    Rectangle()
                        .fill(theme.accentColor)
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(selected ? theme.accentColor : RrradioTheme.ink3)
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
