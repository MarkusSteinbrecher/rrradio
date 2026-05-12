import SwiftUI
import UIKit

enum RrradioTheme {
    static let accent = adaptive(
        light: UIColor(red: 0, green: 0.627, blue: 0.251, alpha: 1),
        dark: UIColor(red: 1, green: 1, blue: 0, alpha: 1),
    )
    static let bg = adaptive(
        light: UIColor(red: 0.945, green: 0.945, blue: 0.925, alpha: 1),
        dark: UIColor(red: 0.245, green: 0.245, blue: 0.225, alpha: 1),
    )
    static let bg2 = adaptive(
        light: UIColor(red: 1, green: 1, blue: 0.984, alpha: 1),
        dark: UIColor(red: 0.305, green: 0.305, blue: 0.280, alpha: 1),
    )
    static let bg3 = adaptive(
        light: UIColor(red: 0.925, green: 0.925, blue: 0.895, alpha: 1),
        dark: UIColor(red: 0.365, green: 0.365, blue: 0.335, alpha: 1),
    )
    static let ink = adaptive(
        light: UIColor(red: 0.055, green: 0.055, blue: 0.050, alpha: 1),
        dark: UIColor(red: 0.957, green: 0.957, blue: 0.949, alpha: 1),
    )
    static let ink2 = ink.opacity(0.80)
    static let ink3 = ink.opacity(0.62)
    static let ink4 = ink.opacity(0.40)
    static let filterIcon = adaptive(
        light: UIColor(red: 0.560, green: 0.560, blue: 0.520, alpha: 1),
        dark: UIColor(red: 0.780, green: 0.780, blue: 0.740, alpha: 1),
    )
    static let line = ink.opacity(0.08)
    static let buttonFill = adaptive(
        light: UIColor(red: 0.305, green: 0.305, blue: 0.280, alpha: 1),
        dark: UIColor(red: 0.957, green: 0.957, blue: 0.949, alpha: 1),
    )
    static let favoriteFill = adaptive(
        light: UIColor(red: 0.430, green: 0.430, blue: 0.390, alpha: 1),
        dark: UIColor(red: 0.957, green: 0.957, blue: 0.949, alpha: 0.72),
    )
    static let stationStars = adaptive(
        light: UIColor(red: 0.380, green: 0.380, blue: 0.350, alpha: 1),
        dark: UIColor(red: 0.860, green: 0.860, blue: 0.820, alpha: 1),
    )

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

struct StationListView: View {
    @Binding private var tab: AppTab
    @Binding private var searchFocusedExternally: Bool
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(ThemeController.self) private var theme
    @Environment(LocaleController.self) private var locale
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private let radioBrowser = RadioBrowserClient()
    private let shareURL = URL(string: "https://rrradio.org")!
    @State private var searchText = ""
    @State private var query = ""
    @State private var source: StationSource = .all
    @State private var showingSettings = false
    @State private var showingMap = false
    @State private var showingNowPlaying = false
    @State private var showingWakeAlarm = false
    @State private var timerCancelConfirmation: TimerCancelTarget?
    @State private var checkedStarSelections: Set<Int> = []
    @State private var selectedGenreIDs: Set<String> = []
    @State private var selectedCountryCodes: Set<String> = []
    @State private var newsFilterSelected = false
    @State private var browseStationSort: BrowseStationSort?
    @State private var activeFilterPicker: ActiveFilterPicker?
    @State private var expandedFilterSections: Set<BrowseFilterSection> = []
    @State private var pendingBrowseFilterState: BrowseFilterState?
    @State private var countrySearchText = ""
    @State private var stationDisplayLimit = 220
    @State private var radioBrowserStations: [Station] = []
    @State private var radioBrowserTotalCount: Int?
    @State private var radioBrowserOffset = 0
    @State private var radioBrowserHasMore = true
    @State private var radioBrowserLoading = false
    @State private var filteredStations: [Station] = []
    @State private var showingFavoritesCatalogFallback = false
    @State private var filterTask: Task<Void, Never>?
    @State private var searchUpdateTask: Task<Void, Never>?
    @State private var radioBrowserSearchTask: Task<Void, Never>?
    @State private var favoriteNowPlaying = FavoriteNowPlayingStore()
    @State private var listScrollOffset: CGFloat = 0
    @State private var pageTransitionDirection = PageTransitionDirection.forward
    @State private var pageDragOffset: CGFloat = 0
    @State private var pageSwipeAxis: PageSwipeAxis?
    @State private var stationInfoPreview: Station?
    @State private var stationInfoPreviewMetadata: [String: NowPlayingMetadata] = [:]
    @State private var stationInfoMetadataTask: Task<Void, Never>?
    @FocusState private var searchFocused: Bool

    private let stationPageSize = 220
    private let searchResultLimit = 5000
    private var statusCollapseDistance: CGFloat { browseControlsExpandedHeight }
    private let browseControlsExpandedHeight: CGFloat = 20
    private let pageSwipeThreshold: CGFloat = 58
    private let pageSwipePreviewThreshold: CGFloat = 24
    private let pageSwipePreviewLimit: CGFloat = 36
    private let pageSwipeAxisLockThreshold: CGFloat = 12
    private let pageSwipeAxisLockRatio: CGFloat = 1.15
    private let pageSwipeDirectionTolerance: CGFloat = 0.55
    private let topbarControlSize: CGFloat = 36
    private let topbarControlSpacing: CGFloat = 8
    private let sortNameColumnOffset: CGFloat = 54
    private let sortAlphabetControlWidth: CGFloat = 44
    private var sortSideColumnWidth: CGFloat { sortNameColumnOffset + sortAlphabetControlWidth }

    private enum ActiveFilterPicker {
        case main
    }

    private enum BrowseFilterSection: String, CaseIterable, Identifiable {
        case genre
        case country
        case checked

        var id: String { rawValue }
    }

    private enum BrowseStationSort: String {
        case alphabetAscending
        case alphabetDescending
        case favoritesAscending
        case favoritesDescending
        case qualityHigh
        case qualityLow
    }

    private enum PageSwipeAxis {
        case horizontal
        case vertical
    }

    private struct BrowseFilterState: Equatable {
        var source: StationSource
        var genreIDs: Set<String>
        var countryCodes: Set<String>
        var newsSelected: Bool
        var checkedStarSelections: Set<Int>
    }

    private enum TimerCancelTarget: Identifiable {
        case wake
        case sleep

        var id: String {
            switch self {
            case .wake: "wake"
            case .sleep: "sleep"
            }
        }

        var title: String {
            switch self {
            case .wake: "Unset wake alarm?"
            case .sleep: "Cancel sleep timer?"
            }
        }

        var message: String {
            switch self {
            case .wake: "This will remove the active wake alarm."
            case .sleep: "This will remove the active sleep timer."
            }
        }

        var confirmLabel: String {
            switch self {
            case .wake: "Unset"
            case .sleep: "Cancel timer"
            }
        }
    }

    private enum StationSource: String, CaseIterable, Identifiable {
        case all = "All"
        case favorites = "Favorites"
        case recents = "Recents"

        var id: String { rawValue }
    }

    private enum PageTransitionDirection {
        case forward
        case backward

        var insertionEdge: Edge {
            switch self {
            case .forward: .trailing
            case .backward: .leading
            }
        }

        var removalEdge: Edge {
            switch self {
            case .forward: .leading
            case .backward: .trailing
            }
        }
    }

    init(
        tab: Binding<AppTab> = .constant(.browse),
        searchFocusedExternally: Binding<Bool> = .constant(false),
    ) {
        _tab = tab
        _searchFocusedExternally = searchFocusedExternally
    }

    private var allStations: [Station] { catalog.browseOrdered }
    private var stationPool: [Station] {
        allStations + radioBrowserStations
    }
    private var countries: [String] { availableCountries(from: allStations) }
    private var filteredCountries: [String] {
        let trimmed = countrySearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return countries }
        let normalized = normalizeForSearch(trimmed)
        return countries.filter { code in
            let surface = "\(countryFlagEmoji(code)) \(countryDisplayName(code)) \(code)"
            if surface.localizedCaseInsensitiveContains(trimmed) {
                return true
            }
            return !normalized.isEmpty && normalizeForSearch(surface).contains(normalized)
        }
    }
    private var genres: [Genre] { availableGenres(from: allStations) }

    private var stations: [Station] {
        switch source {
        case .all:
            if !checkedStarSelections.isEmpty {
                allStations.filter { isCheckedStation($0, selectedStars: checkedStarSelections) }
            } else {
                stationPool
            }
        case .favorites: library.favorites
        case .recents: library.recents
        }
    }

    private var displayLimit: Int {
        min(stationDisplayLimit, filteredStations.count)
    }

    private var visibleStations: [Station] { Array(filteredStations.prefix(displayLimit)) }
    private var usesFavoritesRows: Bool {
        isFavoritesPage && !showingFavoritesCatalogFallback
    }
    private var settingsColorScheme: ColorScheme {
        theme.preferredColorScheme ?? colorScheme
    }
    private var settingsColorSchemeKey: String {
        switch settingsColorScheme {
        case .light: "light"
        case .dark: "dark"
        @unknown default: "system"
        }
    }
    private var mapSelectedCountryBinding: Binding<String?> {
        Binding(
            get: { selectedCountryCodes.sorted().first },
            set: { country in
                if let country {
                    selectedCountryCodes = [country]
                } else {
                    selectedCountryCodes = []
                }
            },
        )
    }
    private var stationMapSheet: some View {
        StationMapView(
            stations: allStations,
            selectedCountry: mapSelectedCountryBinding,
            onSelectCountry: selectMapCountry,
            onOpenStation: openMapStation,
        )
    }
    private var timerCancelConfirmationTitle: String {
        timerCancelConfirmation?.title ?? ""
    }
    private var timerCancelConfirmationBinding: Binding<Bool> {
        Binding(
            get: { timerCancelConfirmation != nil },
            set: { presented in
                if !presented {
                    timerCancelConfirmation = nil
                }
            },
        )
    }
    private var hasActiveFilters: Bool {
        !selectedGenreIDs.isEmpty || !selectedCountryCodes.isEmpty || newsFilterSelected
    }
    private var hasActiveCheckedFilter: Bool {
        !checkedStarSelections.isEmpty
    }
    private var hasActiveFiltersForCurrentSource: Bool {
        source == .all && (hasActiveFilters || hasActiveCheckedFilter)
    }
    private var hasActiveBrowseFilter: Bool {
        source == .recents || hasActiveFilters || hasActiveCheckedFilter
    }
    private var isFavoritesPage: Bool {
        tab == .favorites && source == .favorites
    }
    private var filterSignature: String {
        [
            source.rawValue,
            query,
            selectedGenreIDs.sorted().joined(separator: ","),
            selectedCountryCodes.sorted().joined(separator: ","),
            newsFilterSelected ? "news" : "",
            checkedStarSelections.sorted().map(String.init).joined(separator: ","),
            browseStationSort?.rawValue ?? "",
            "\(catalog.browseOrdered.count)",
            "\(library.favorites.count)",
            "\(library.recents.count)",
            "\(library.customStations.count)",
            "\(radioBrowserStations.count)",
        ].joined(separator: "\u{1f}")
    }

    var body: some View {
        pageShell
            .offset(x: pageDragOffset)
            .background(RrradioTheme.bg)
            .simultaneousGesture(pageSwipeGesture)
            .sheet(isPresented: $showingSettings) {
                SettingsView()
                    .id("\(theme.choice.rawValue)-\(settingsColorSchemeKey)")
                    .preferredColorScheme(settingsColorScheme)
            }
            .sheet(isPresented: $showingMap) {
                stationMapSheet
            }
            .sheet(isPresented: $showingNowPlaying) {
                NowPlayingView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.hidden)
            }
            .sheet(isPresented: $showingWakeAlarm) {
                WakeAlarmView()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .overlay {
                stationInfoPreviewOverlay
            }
            .animation(.spring(response: 0.24, dampingFraction: 0.86), value: stationInfoPreview?.id)
            .confirmationDialog(
                timerCancelConfirmationTitle,
                isPresented: timerCancelConfirmationBinding,
                presenting: timerCancelConfirmation,
            ) { target in
                Button(target.confirmLabel, role: .destructive) {
                    switch target {
                    case .wake:
                        wakeAlarm.disarm()
                    case .sleep:
                        sleepTimer.cancel()
                    }
                    timerCancelConfirmation = nil
                }
            } message: { target in
                Text(target.message)
            }
            .onAppear {
                library.refreshFavorites(from: catalog.stations)
                recomputeFilteredStations()
                updateFavoriteNowPlayingPolling()
            }
            .onChange(of: tab) { oldValue, value in
                updatePageTransitionDirection(from: oldValue, to: value)
                setSource(stationSource(for: value), animated: true)
            }
            .onChange(of: source) { _, value in
                resetStationDisplayLimit()
                listScrollOffset = 0
                let targetTab = appTab(for: value)
                guard targetTab != tab else { return }
                updatePageTransitionDirection(from: tab, to: targetTab)
                withAnimation(.snappy) {
                    tab = targetTab
                }
            }
            .onChange(of: query) { _, _ in
                resetStationDisplayLimit()
                resetRadioBrowserStations()
                fetchInitialRadioBrowserPageIfNeeded()
            }
            .onChange(of: searchText) { _, value in
                scheduleSearchUpdate(value)
            }
            .onChange(of: selectedCountryCodes) { _, _ in
                resetStationDisplayLimit()
                resetRadioBrowserStations()
                fetchInitialRadioBrowserPageIfNeeded()
            }
            .onChange(of: selectedGenreIDs) { _, _ in
                resetStationDisplayLimit()
                resetRadioBrowserStations()
                fetchInitialRadioBrowserPageIfNeeded()
            }
            .onChange(of: newsFilterSelected) { _, _ in
                resetStationDisplayLimit()
                resetRadioBrowserStations()
                fetchInitialRadioBrowserPageIfNeeded()
            }
            .onChange(of: checkedStarSelections) { _, _ in
                resetStationDisplayLimit()
                resetRadioBrowserStations()
                fetchInitialRadioBrowserPageIfNeeded()
            }
            .onChange(of: filterSignature) { _, _ in
                recomputeFilteredStations()
                updateFavoriteNowPlayingPolling()
            }
            .onChange(of: catalog.stations) { _, stations in
                library.refreshFavorites(from: stations)
                recomputeFilteredStations()
                updateFavoriteNowPlayingPolling()
            }
            .onChange(of: searchFocused) { _, focused in
                searchFocusedExternally = focused
            }
            .onDisappear(perform: handleDisappear)
            .onChange(of: activeFilterPicker) { _, picker in
                if picker == nil {
                    pendingBrowseFilterState = nil
                }
            }
    }

    private var pageSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 28, coordinateSpace: .local)
            .onChanged { value in
                updatePageSwipeOffset(translation: value.translation)
            }
            .onEnded { value in
                handlePageSwipe(translation: value.translation)
            }
    }

    private func updatePageSwipeOffset(translation: CGSize) {
        guard canUsePageSwipe else {
            resetPageSwipeTracking()
            return
        }

        let horizontal = translation.width
        let vertical = translation.height
        updatePageSwipeAxis(horizontal: horizontal, vertical: vertical)
        guard pageSwipeAxis == .horizontal else {
            resetPageSwipeOffset()
            return
        }
        guard abs(horizontal) >= pageSwipePreviewThreshold,
              isPageSwipeDirection(horizontal: horizontal, vertical: vertical) else {
            resetPageSwipeOffset()
            return
        }
        guard (horizontal < 0 && nextTab != nil) || (horizontal > 0 && previousTab != nil) else {
            resetPageSwipeOffset()
            return
        }

        pageDragOffset = min(max(horizontal * 0.28, -pageSwipePreviewLimit), pageSwipePreviewLimit)
    }

    private func handlePageSwipe(translation: CGSize) {
        guard canUsePageSwipe else {
            resetPageSwipeTracking()
            return
        }

        let horizontal = translation.width
        let vertical = translation.height
        updatePageSwipeAxis(horizontal: horizontal, vertical: vertical)
        defer {
            pageSwipeAxis = nil
        }
        guard pageSwipeAxis == .horizontal,
              abs(horizontal) >= pageSwipeThreshold,
              isPageSwipeDirection(horizontal: horizontal, vertical: vertical) else {
            resetPageSwipeOffset()
            return
        }

        if horizontal < 0, let nextTab {
            switchToSwipeTab(nextTab)
        } else if horizontal > 0, let previousTab {
            switchToSwipeTab(previousTab)
        } else {
            resetPageSwipeOffset()
        }
    }

    private var canUsePageSwipe: Bool {
        activeFilterPicker == nil && stationInfoPreview == nil && !searchFocused
    }

    private var isHorizontalPageSwipeLocked: Bool {
        pageSwipeAxis == .horizontal
    }

    private func updatePageSwipeAxis(horizontal: CGFloat, vertical: CGFloat) {
        guard pageSwipeAxis == nil else { return }

        let absHorizontal = abs(horizontal)
        let absVertical = abs(vertical)
        guard max(absHorizontal, absVertical) >= pageSwipeAxisLockThreshold else { return }

        if absHorizontal > absVertical * pageSwipeAxisLockRatio {
            pageSwipeAxis = .horizontal
        } else if absVertical > absHorizontal * pageSwipeAxisLockRatio {
            pageSwipeAxis = .vertical
        }
    }

    private func isPageSwipeDirection(horizontal: CGFloat, vertical: CGFloat) -> Bool {
        abs(horizontal) > abs(vertical) * pageSwipeDirectionTolerance
    }

    private var nextTab: AppTab? {
        switch tab {
        case .browse: .favorites
        case .favorites: nil
        }
    }

    private var previousTab: AppTab? {
        switch tab {
        case .browse: nil
        case .favorites: .browse
        }
    }

    private func switchToSwipeTab(_ newTab: AppTab) {
        guard newTab != tab else { return }
        withAnimation(.snappy) {
            pageDragOffset = 0
            tab = newTab
        }
    }

    private func resetPageSwipeOffset() {
        guard pageDragOffset != 0 else { return }
        withAnimation(.snappy) {
            pageDragOffset = 0
        }
    }

    private func resetPageSwipeTracking() {
        pageSwipeAxis = nil
        resetPageSwipeOffset()
    }

    private func handleDisappear() {
        filterTask?.cancel()
        searchUpdateTask?.cancel()
        radioBrowserSearchTask?.cancel()
        stationInfoMetadataTask?.cancel()
        favoriteNowPlaying.stop()
        searchFocusedExternally = false
    }

    private var pageShell: some View {
        VStack(spacing: 0) {
            topbar
            switch catalog.state {
            case .idle, .loading:
                if source == .all && catalog.stations.isEmpty {
                    ProgressView("Loading catalog...")
                        .tint(RrradioTheme.accent)
                        .foregroundStyle(RrradioTheme.ink2)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    content
                }
            case .loaded:
                content
            case .failed(let message):
                if source == .all {
                    ContentUnavailableView(
                        "Catalog unavailable",
                        systemImage: "antenna.radiowaves.left.and.right.slash",
                        description: Text(message),
                    )
                    .foregroundStyle(RrradioTheme.ink)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    content
                }
            }
        }
        .id(source)
        .transition(pageTransition)
        .animation(.snappy, value: source)
    }

    private var pageTransition: AnyTransition {
        .asymmetric(
            insertion: .move(edge: pageTransitionDirection.insertionEdge).combined(with: .opacity),
            removal: .move(edge: pageTransitionDirection.removalEdge).combined(with: .opacity),
        )
    }

    private func setSource(_ newSource: StationSource, animated: Bool) {
        guard source != newSource else { return }
        if animated {
            withAnimation(.snappy) {
                source = newSource
            }
        } else {
            source = newSource
        }
    }

    private func toggleRecentsFilter(closePicker: Bool = true) {
        let wasShowingRecents = source == .recents
        dismissSearch()
        if closePicker {
            activeFilterPicker = nil
        }
        clearBrowseFilters()
        setSource(wasShowingRecents ? .all : .recents, animated: true)
    }

    private func showBrowseFilters() {
        source = .all
        dismissSearch()
    }

    private func selectMapCountry(_ country: String?) {
        setSource(.all, animated: true)
        if let country {
            selectedCountryCodes = [country]
        } else {
            selectedCountryCodes = []
        }
    }

    private func openMapStation(_ station: Station) {
        player.play(station)
        library.pushRecent(station)
        showingMap = false
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            showingNowPlaying = true
        }
    }

    private func applyGenreFilter(_ genreID: String) {
        showBrowseFilters()
        toggleSetMembership(genreID, in: &selectedGenreIDs)
    }

    private func applyNewsFilter() {
        showBrowseFilters()
        newsFilterSelected.toggle()
    }

    private func applyCountryFilter(_ code: String) {
        showBrowseFilters()
        toggleSetMembership(code, in: &selectedCountryCodes)
        countrySearchText = ""
    }

    private func applyCheckedFilter(starCount: Int) {
        showBrowseFilters()
        toggleSetMembership(starCount, in: &checkedStarSelections)
    }

    private func clearBrowseFilters() {
        selectedGenreIDs = []
        selectedCountryCodes = []
        newsFilterSelected = false
        checkedStarSelections = []
    }

    private var currentBrowseFilterState: BrowseFilterState {
        BrowseFilterState(
            source: source,
            genreIDs: selectedGenreIDs,
            countryCodes: selectedCountryCodes,
            newsSelected: newsFilterSelected,
            checkedStarSelections: checkedStarSelections,
        )
    }

    private func openBrowseFilterWidget() {
        searchFocused = false
        if activeFilterPicker == .main {
            activeFilterPicker = nil
            return
        }
        pendingBrowseFilterState = currentBrowseFilterState
        activeFilterPicker = .main
    }

    private func acceptBrowseFilterWidget() {
        pendingBrowseFilterState = nil
        activeFilterPicker = nil
    }

    private func cancelBrowseFilterWidget() {
        if let state = pendingBrowseFilterState {
            source = state.source
            selectedGenreIDs = state.genreIDs
            selectedCountryCodes = state.countryCodes
            newsFilterSelected = state.newsSelected
            checkedStarSelections = state.checkedStarSelections
        }
        pendingBrowseFilterState = nil
        countrySearchText = ""
        activeFilterPicker = nil
    }

    private func toggleSetMembership<Value: Hashable>(_ value: Value, in set: inout Set<Value>) {
        if set.contains(value) {
            set.remove(value)
        } else {
            set.insert(value)
        }
    }

    private func updatePageTransitionDirection(from oldTab: AppTab, to newTab: AppTab) {
        guard oldTab != newTab else { return }
        pageTransitionDirection = tabPosition(newTab) > tabPosition(oldTab) ? .forward : .backward
    }

    private func stationSource(for tab: AppTab) -> StationSource {
        switch tab {
        case .browse: .all
        case .favorites: .favorites
        }
    }

    private func appTab(for source: StationSource) -> AppTab {
        switch source {
        case .all: .browse
        case .favorites: .favorites
        case .recents: .browse
        }
    }

    private func tabPosition(_ tab: AppTab) -> Int {
        switch tab {
        case .browse: 0
        case .favorites: 1
        }
    }

    @ViewBuilder
    private var topbar: some View {
        if verticalSizeClass == .compact {
            compactTopbar
        } else {
            regularTopbar
        }
    }

    private var regularTopbar: some View {
        VStack(spacing: 14) {
            brandActionsRow
            searchAndFilterRow
            if tab != .browse {
                statusToolbar
                    .frame(height: 14, alignment: .center)
            }
        }
        .topbarChrome(top: 14, bottom: tab == .browse ? 8 : 10)
        .collapsingTopbarDivider(opacity: topbarDividerOpacity)
    }

    private var compactTopbar: some View {
        VStack(spacing: 8) {
            brandActionsRow
            searchAndFilterRow
                .frame(minWidth: 220, maxWidth: .infinity)
            if tab != .browse {
                statusToolbar
                    .frame(height: 14, alignment: .center)
            }
        }
        .topbarChrome(top: 8, bottom: 6)
        .collapsingTopbarDivider(opacity: topbarDividerOpacity)
    }

    private var topbarCollapse: CGFloat {
        min(max(listScrollOffset, 0), statusCollapseDistance)
    }

    private var topbarDividerOpacity: CGFloat {
        min(max(topbarCollapse / 8, 0), 1)
    }

    private var secondaryBrowseControls: some View {
        Group {
            if showsBrowseSortControls {
                browseSortRow
            } else {
                statusToolbar
            }
        }
        .frame(height: browseControlsExpandedHeight, alignment: .center)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var inlineBrowseControls: some View {
        secondaryBrowseControls
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity)
    }

    private var brandActionsRow: some View {
        HStack(alignment: .center) {
            Button {
                searchText = ""
                query = ""
                searchFocused = false
                source = .all
                clearBrowseFilters()
                browseStationSort = nil
                activeFilterPicker = nil
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("r r r")
                        .foregroundStyle(RrradioTheme.accent)
                    Text("a d i o . o r g")
                        .foregroundStyle(RrradioTheme.ink)
                    Text("beta")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(RrradioTheme.accent)
                        .baselineOffset(4)
                }
                .font(.system(size: 16, weight: .medium))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(locale.text(.goHome))

            Spacer()

            HStack(spacing: topbarControlSpacing) {
                ShareLink(
                    item: shareURL,
                    subject: Text("rrradio.org"),
                    message: Text("Free internet radio without ads.")
                ) {
                    circularIconLabel("square.and.arrow.up")
                }
                .buttonStyle(.plain)
                .accessibilityLabel(locale.text(.share))
                .simultaneousGesture(TapGesture().onEnded(dismissSearch))

                circularIconButton("gearshape", label: locale.text(.settings)) {
                    dismissSearch()
                    showingSettings = true
                }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
            TextField(searchPlaceholder, text: $searchText)
                .font(.system(size: 16))
                .foregroundStyle(RrradioTheme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit {
                    searchUpdateTask?.cancel()
                    query = searchText
                    searchFocused = false
                }
                .onChange(of: searchFocused) { _, focused in
                    if focused {
                        activeFilterPicker = nil
                    }
                }
            Button {
                searchUpdateTask?.cancel()
                searchText = ""
                query = ""
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .opacity(searchText.isEmpty ? 0 : 1)
            .disabled(searchText.isEmpty)
            .accessibilityHidden(searchText.isEmpty)
            .accessibilityLabel(locale.text(.clearSearch))
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 9)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
    }

    private var searchAndFilterRow: some View {
        HStack(spacing: topbarControlSpacing) {
            searchField
                .frame(maxWidth: .infinity)
            if tab == .browse {
                filterPill
            }
        }
    }

    @ViewBuilder
    private var browseSortRow: some View {
        if showsBrowseSortControls {
            HStack(spacing: 0) {
                HStack(spacing: 0) {
                    Color.clear
                        .frame(width: sortNameColumnOffset, height: 1)
                        .accessibilityHidden(true)
                    alphabetSortButton
                }
                .frame(width: sortSideColumnWidth, alignment: .leading)

                sectionStatus
                    .frame(maxWidth: .infinity, alignment: .center)

                HStack(spacing: topbarControlSpacing) {
                    browseSortButton(
                        systemImage: qualitySortSystemImage,
                        width: topbarControlSize,
                        active: isQualitySortActive,
                        label: qualitySortAccessibilityLabel,
                        action: cycleQualitySort,
                    )
                    browseSortButton(
                        systemImage: favoriteSortSystemImage,
                        width: topbarControlSize,
                        active: isFavoriteSortActive,
                        label: favoriteSortAccessibilityLabel,
                        action: cycleFavoriteSort,
                    )
                }
                .frame(width: sortSideColumnWidth, alignment: .trailing)
            }
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .center)
        }
    }

    private var filterPill: some View {
        HStack(spacing: hasActiveBrowseFilter ? topbarControlSpacing : 0) {
            Button {
                openBrowseFilterWidget()
            } label: {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(hasActiveBrowseFilter ? RrradioTheme.accent : RrradioTheme.filterIcon)
                    .frame(width: topbarControlSize, height: topbarControlSize)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Browse filters")

            if hasActiveBrowseFilter {
                Button {
                    if source == .recents {
                        setSource(.all, animated: true)
                    }
                    clearBrowseFilters()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                        .frame(width: topbarControlSize, height: topbarControlSize)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear browse filters")
            }
        }
        .frame(
            width: hasActiveBrowseFilter ? topbarControlSize * 2 + topbarControlSpacing : topbarControlSize,
            height: topbarControlSize,
        )
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
        .animation(.snappy(duration: 0.18), value: hasActiveBrowseFilter)
        .popover(
            isPresented: Binding(
                get: { activeFilterPicker != nil },
                set: { if !$0 { activeFilterPicker = nil } },
            ),
            attachmentAnchor: .rect(.bounds),
            arrowEdge: .top,
        ) {
            filterPickerPopover
                .presentationCompactAdaptation(.popover)
        }
    }

    @ViewBuilder
    private var filterPickerPopover: some View {
        if activeFilterPicker != nil {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 0) {
                        filterSectionHeader(
                            locale.text(.genre),
                            section: .genre,
                            selectedCount: selectedGenreIDs.count + (newsFilterSelected ? 1 : 0),
                            leadingSystemImage: "music.note",
                        )
                        if expandedFilterSections.contains(.genre) {
                            filterPickerRow(locale.text(.news), selected: newsFilterSelected, leadingSystemImage: "newspaper") {
                                applyNewsFilter()
                            }
                            ForEach(genres) { genre in
                                filterPickerRow(genre.label, selected: selectedGenreIDs.contains(genre.id)) {
                                    applyGenreFilter(genre.id)
                                }
                            }
                        }

                        filterSectionHeader(
                            locale.text(.country),
                            section: .country,
                            selectedCount: selectedCountryCodes.count,
                            leadingSystemImage: "flag",
                        )
                        if expandedFilterSections.contains(.country) {
                            countrySearchRow
                            ForEach(filteredCountries, id: \.self) { code in
                                filterPickerRow("\(countryDisplayName(code)) (\(code))", selected: selectedCountryCodes.contains(code), leadingText: countryFlagEmoji(code)) {
                                    applyCountryFilter(code)
                                }
                            }
                        }

                        filterSectionHeader(
                            locale.text(.checked),
                            section: .checked,
                            selectedCount: checkedStarSelections.count,
                            leadingSystemImage: "star",
                        )
                        if expandedFilterSections.contains(.checked) {
                            filterPickerStarsRow(starCount: 0, selected: checkedStarSelections.contains(0)) {
                                applyCheckedFilter(starCount: 0)
                            }
                            filterPickerStarsRow(starCount: 1, selected: checkedStarSelections.contains(1)) {
                                applyCheckedFilter(starCount: 1)
                            }
                            filterPickerStarsRow(starCount: 2, selected: checkedStarSelections.contains(2)) {
                                applyCheckedFilter(starCount: 2)
                            }
                            filterPickerStarsRow(starCount: 3, selected: checkedStarSelections.contains(3)) {
                                applyCheckedFilter(starCount: 3)
                            }
                            filterPickerStarsRow(starCount: 4, selected: checkedStarSelections.contains(4)) {
                                applyCheckedFilter(starCount: 4)
                            }
                        }

                        filterPickerRow(locale.text(.recents), selected: source == .recents, leadingSystemImage: "clock", showsSeparator: false) {
                            toggleRecentsFilter(closePicker: false)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 6)

                HStack(spacing: 10) {
                    Spacer()
                    Button(action: cancelBrowseFilterWidget) {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(RrradioTheme.ink3)
                            .frame(width: 34, height: 30)
                            .background(RrradioTheme.bg)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(RrradioTheme.line))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel filters")

                    Button(action: acceptBrowseFilterWidget) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(RrradioTheme.bg)
                            .frame(width: 34, height: 30)
                            .background(RrradioTheme.accent)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Apply filters")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .frame(width: 320)
            .frame(maxHeight: 560)
            .background(RrradioTheme.bg2)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(RrradioTheme.line)
            }
        }
    }

    private var sectionStatus: some View {
        HStack(spacing: 8) {
            if showsStatusLabel {
                Text(statusLabel)
                    .foregroundStyle(statusLabelColor)
                Text(".")
                    .foregroundStyle(RrradioTheme.ink4)
            }
            Text(statusCountLabel)
                .foregroundStyle(showsStatusLabel ? RrradioTheme.ink4 : RrradioTheme.ink3)
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .textCase(.uppercase)
        .tracking(1.5)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .foregroundStyle(RrradioTheme.ink3)
        .frame(maxWidth: .infinity, minHeight: 20, alignment: .center)
    }

    private var statusToolbar: some View {
        sectionStatus
    }

    private var showsStatusLabel: Bool {
        switch source {
        case .all:
            !activeFilterLabels.isEmpty
        case .favorites, .recents:
            true
        }
    }

    private var statusLabelColor: Color {
        source == .all && !activeFilterLabels.isEmpty ? RrradioTheme.accent : RrradioTheme.ink3
    }

    private var showsBrowseSortControls: Bool {
        tab == .browse && source == .all
    }

    private var isAlphabetSortActive: Bool {
        browseStationSort == .alphabetAscending || browseStationSort == .alphabetDescending
    }

    private var isQualitySortActive: Bool {
        browseStationSort == .qualityHigh || browseStationSort == .qualityLow
    }

    private var isFavoriteSortActive: Bool {
        browseStationSort == .favoritesAscending || browseStationSort == .favoritesDescending
    }

    private var qualitySortSystemImage: String {
        switch browseStationSort {
        case .qualityLow:
            "arrow.up"
        case .qualityHigh:
            "arrow.down"
        default:
            "arrow.up.arrow.down"
        }
    }

    private var favoriteSortSystemImage: String {
        switch browseStationSort {
        case .favoritesAscending:
            "arrow.up"
        case .favoritesDescending:
            "arrow.down"
        default:
            "arrow.up.arrow.down"
        }
    }

    private var alphabetSortTitle: String {
        switch browseStationSort {
        case .alphabetDescending:
            "Z-A"
        default:
            "A-Z"
        }
    }

    private var alphabetSortAccessibilityLabel: String {
        switch browseStationSort {
        case .alphabetAscending:
            "Sort stations Z to A"
        case .alphabetDescending:
            "Clear alphabetic sort"
        default:
            "Sort stations A to Z"
        }
    }

    private var qualitySortAccessibilityLabel: String {
        switch browseStationSort {
        case .qualityLow:
            "Sort quality descending"
        case .qualityHigh:
            "Clear quality sort"
        default:
            "Sort quality ascending"
        }
    }

    private var favoriteSortAccessibilityLabel: String {
        switch browseStationSort {
        case .favoritesAscending:
            "Sort favorites descending"
        case .favoritesDescending:
            "Clear favorite sort"
        default:
            "Sort favorites ascending"
        }
    }

    private func cycleAlphabetSort() {
        switch browseStationSort {
        case .alphabetAscending:
            browseStationSort = .alphabetDescending
        case .alphabetDescending:
            browseStationSort = nil
        default:
            browseStationSort = .alphabetAscending
        }
    }

    private func cycleQualitySort() {
        switch browseStationSort {
        case .qualityLow:
            browseStationSort = .qualityHigh
        case .qualityHigh:
            browseStationSort = nil
        default:
            browseStationSort = .qualityLow
        }
    }

    private func cycleFavoriteSort() {
        switch browseStationSort {
        case .favoritesAscending:
            browseStationSort = .favoritesDescending
        case .favoritesDescending:
            browseStationSort = nil
        default:
            browseStationSort = .favoritesAscending
        }
    }

    private var alphabetSortButton: some View {
        Button(action: cycleAlphabetSort) {
            Text(alphabetSortTitle)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(isAlphabetSortActive ? RrradioTheme.accent : RrradioTheme.ink3)
                .frame(width: sortAlphabetControlWidth, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(alphabetSortAccessibilityLabel)
    }

    private func browseSortButton(
        systemImage: String,
        width: CGFloat,
        active: Bool,
        label: String,
        action: @escaping () -> Void,
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(active ? RrradioTheme.accent : RrradioTheme.ink3)
                .frame(width: width, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func filterSectionHeader(
        _ title: String,
        section: BrowseFilterSection,
        selectedCount: Int,
        leadingSystemImage: String,
    ) -> some View {
        Button {
            if expandedFilterSections.contains(section) {
                expandedFilterSections.remove(section)
            } else {
                expandedFilterSections.insert(section)
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: leadingSystemImage)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(selectedCount > 0 ? RrradioTheme.accent : RrradioTheme.ink3)
                    .frame(width: 22, alignment: .leading)
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink)
                if selectedCount > 0 {
                    Text("\(selectedCount)")
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(RrradioTheme.bg)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Circle().fill(RrradioTheme.accent))
                }
                Spacer()
                Image(systemName: expandedFilterSections.contains(section) ? "chevron.up" : "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var content: some View {
        Group {
            if filteredStations.isEmpty {
                ContentUnavailableView(
                    emptyTitle,
                    systemImage: emptyIcon,
                    description: Text(emptyDescription),
                )
                .foregroundStyle(RrradioTheme.ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                list
            }
        }
    }

    @ViewBuilder
    private var list: some View {
        if usesFavoritesRows {
            sortableFavoritesList
        } else {
            stationScrollList
        }
    }

    private var stationScrollList: some View {
        ScrollView(showsIndicators: false) {
            ScrollOffsetObserver(offset: $listScrollOffset, maximumOffset: statusCollapseDistance)
                .frame(width: 0, height: 0)

            LazyVStack(spacing: 6, pinnedViews: [.sectionHeaders]) {
                if tab == .browse {
                    inlineBrowseControls
                }

                Section {
                    if showingFavoritesCatalogFallback {
                        favoritesCatalogFallbackNotice
                    }

                    ForEach(visibleStations) { station in
                        StationRow(
                            station: station,
                            nowPlaying: usesFavoritesRows ? favoriteNowPlaying.entries[station.id]?.metadata : nil,
                            mode: usesFavoritesRows ? .favoritesExpanded : .standard,
                            isCurrent: player.current?.id == station.id,
                            isPlaying: player.current?.id == station.id && player.state == .playing,
                            isFavorite: library.isFavorite(station),
                            isCustom: library.isCustom(station),
                            onPlay: {
                                play(station)
                            },
                            onToggleFavorite: {
                                library.toggleFavorite(station)
                            },
                            showsFavoriteButton: !usesFavoritesRows,
                            onInfoHoldChanged: source == .all ? { isHolding in
                                handleStationInfoHoldChanged(isHolding, station: station)
                            } : nil,
                        )
                    }
                    if visibleStations.count < filteredStations.count || canLoadWorldwideStations {
                        loadMoreRow
                    }
                } header: {
                    timerStatusStrip
                }
            }
            .padding(.top, 6)
            .padding(.bottom, 12)
        }
        .scrollDismissesKeyboard(.immediately)
        .scrollDisabled(isHorizontalPageSwipeLocked)
        .background(RrradioTheme.bg)
    }

    private var favoritesCatalogFallbackNotice: some View {
        Text(locale.text(.noFavoriteSearchResultsShowingCatalog))
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(RrradioTheme.ink2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(RrradioTheme.bg2)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
    }

    private var sortableFavoritesList: some View {
        List {
            if hasTimerStatus {
                timerStatusStrip
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(RrradioTheme.bg)
                    .textCase(nil)
            }

            ForEach(visibleStations) { station in
                StationRow(
                    station: station,
                    nowPlaying: favoriteNowPlaying.entries[station.id]?.metadata,
                    mode: .favoritesExpanded,
                    isCurrent: player.current?.id == station.id,
                    isPlaying: player.current?.id == station.id && player.state == .playing,
                    isFavorite: true,
                    isCustom: library.isCustom(station),
                    onPlay: {
                        play(station)
                    },
                    onToggleFavorite: {},
                    showsFavoriteButton: false,
                )
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(RrradioTheme.bg)
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        removeFavorite(station)
                    } label: {
                        Image(systemName: "trash")
                            .frame(width: 58, height: 58)
                    }
                    .tint(.red)
                    .accessibilityLabel(locale.text(.removeFavorite))
                }
                .moveDisabled(!canReorderFavorites)
            }
            .onMove(perform: moveFavoriteRows)
            .onDelete(perform: removeFavoriteRows)

            if visibleStations.count < filteredStations.count {
                loadMoreRow
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(RrradioTheme.bg)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.immediately)
        .scrollIndicators(.hidden)
        .scrollDisabled(isHorizontalPageSwipeLocked)
        .background(RrradioTheme.bg)
        .background {
            ScrollOffsetObserver(offset: $listScrollOffset)
                .frame(width: 0, height: 0)
        }
    }

    private func play(_ station: Station) {
        dismissSearch()
        player.play(station)
        if let metadata = favoriteNowPlaying.entries[station.id]?.metadata {
            player.applyPrefetchedMetadata(metadata, for: station)
        }
        if !library.isCustom(station) {
            library.pushRecent(station)
        }
        showingNowPlaying = true
    }

    @ViewBuilder
    private var stationInfoPreviewOverlay: some View {
        if let station = stationInfoPreview {
            ZStack {
                Color.black.opacity(0.18)
                    .ignoresSafeArea()
                StationInfoPreview(
                    station: station,
                    nowPlaying: stationInfoMetadata(for: station),
                    isCurrent: player.current?.id == station.id,
                    isPlaying: player.current?.id == station.id && player.state == .playing,
                )
                .padding(.horizontal, 22)
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            }
            .allowsHitTesting(false)
        }
    }

    private func handleStationInfoHoldChanged(_ isHolding: Bool, station: Station) {
        if isHolding {
            showStationInfoPreview(station)
        } else {
            closeStationInfoPreview()
        }
    }

    private func showStationInfoPreview(_ station: Station) {
        dismissSearch()
        let didChangeStation = stationInfoPreview?.id != station.id
        stationInfoPreview = station
        if didChangeStation {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        fetchStationInfoMetadataIfNeeded(for: station)
    }

    private func closeStationInfoPreview() {
        stationInfoMetadataTask?.cancel()
        stationInfoMetadataTask = nil
        stationInfoPreview = nil
    }

    private func stationInfoMetadata(for station: Station) -> NowPlayingMetadata? {
        if player.current?.id == station.id {
            let raw = [
                cleanInfoValue(player.nowPlayingArtist),
                cleanInfoValue(player.nowPlayingTitle),
            ]
            .compactMap { $0 }
            .joined(separator: " - ")
            .nilIfEmpty

            return NowPlayingMetadata(
                artist: cleanInfoValue(player.nowPlayingArtist),
                title: cleanInfoValue(player.nowPlayingTitle),
                raw: raw ?? station.name,
                programName: cleanInfoValue(player.nowPlayingProgramName),
                programSubtitle: cleanInfoValue(player.nowPlayingProgramSubtitle),
                coverUrl: player.nowPlayingCoverUrl,
            )
        }
        return stationInfoPreviewMetadata[station.id] ?? favoriteNowPlaying.entries[station.id]?.metadata
    }

    private func fetchStationInfoMetadataIfNeeded(for station: Station) {
        guard player.current?.id != station.id,
              stationInfoPreviewMetadata[station.id] == nil,
              favoriteNowPlaying.entries[station.id] == nil else {
            return
        }
        stationInfoMetadataTask?.cancel()
        stationInfoMetadataTask = Task {
            let metadata = await FavoriteNowPlayingStore.fetchMetadata(for: station)
            guard !Task.isCancelled, let metadata else { return }
            await MainActor.run {
                guard stationInfoPreview?.id == station.id else { return }
                stationInfoPreviewMetadata[station.id] = metadata
            }
        }
    }

    private func cleanInfoValue(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    private var canReorderFavorites: Bool {
        isFavoritesPage && query.isEmpty
    }

    private func moveFavoriteRows(from source: IndexSet, to destination: Int) {
        guard canReorderFavorites else { return }
        filterTask?.cancel()

        var ordered = filteredStations
        ordered.move(fromOffsets: source, toOffset: destination)
        filteredStations = ordered
        library.reorderFavorites(ordered.map(\.id))
    }

    private func removeFavoriteRows(at offsets: IndexSet) {
        let stationsToRemove = offsets.compactMap { index in
            visibleStations.indices.contains(index) ? visibleStations[index] : nil
        }
        stationsToRemove.forEach(removeFavorite)
    }

    private func removeFavorite(_ station: Station) {
        guard isFavoritesPage else { return }
        filterTask?.cancel()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        _ = library.toggleFavorite(station)
        filteredStations.removeAll { $0.id == station.id }
    }

    private func updateFavoriteNowPlayingPolling() {
        guard usesFavoritesRows else {
            favoriteNowPlaying.stop()
            return
        }
        favoriteNowPlaying.start(stations: library.favorites)
    }

    private var loadMoreRow: some View {
        VStack(spacing: 10) {
            Text("\(locale.text(.showing)) \(visibleStations.count) \(locale.text(.of)) \(filteredStations.count)")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.2)
                .foregroundStyle(RrradioTheme.ink3)

            Button {
                loadMoreStations()
            } label: {
                Text(radioBrowserLoading ? locale.text(.loading) : locale.text(.loadMore))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
                    .foregroundStyle(RrradioTheme.ink)
                    .frame(height: 36)
                    .padding(.horizontal, 18)
                    .overlay(Capsule().stroke(RrradioTheme.line))
            }
            .buttonStyle(.plain)
            .disabled(radioBrowserLoading)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    @ViewBuilder
    private var timerStatusStrip: some View {
        if hasTimerStatus {
            TimelineView(.periodic(from: .now, by: 30)) { timeline in
                VStack(spacing: 0) {
                    if wakeAlarm.isArmed {
                        timerStatusRow(
                            icon: "alarm.fill",
                            title: locale.text(.wake),
                            detail: wakeStatusText(at: timeline.date),
                            station: wakeAlarm.station,
                            cancelTarget: .wake,
                        )
                    }
                }
            }
        }
    }

    private var hasTimerStatus: Bool {
        wakeAlarm.isArmed
    }

    private func timerStatusRow(
        icon: String,
        title: String,
        detail: String,
        station: Station?,
        cancelTarget: TimerCancelTarget,
    ) -> some View {
        HStack(spacing: 14) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(RrradioTheme.bg2)
                        .overlay(RoundedRectangle(cornerRadius: 2).stroke(RrradioTheme.line))
                    Image(systemName: icon)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
                .frame(width: 38, height: 38)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        Text(station?.name ?? locale.text(.noStation))
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                            .lineLimit(1)
                        if let cc = station?.country {
                            Text(cc.uppercased())
                                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(RrradioTheme.ink3)
                        }
                    }

                    HStack(spacing: 5) {
                        timerCapabilityStars(for: station)
                        if cancelTarget == .sleep {
                            Text(title.lowercased())
                                .lineLimit(1)
                        }
                    }
                    .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .textCase(.lowercase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .foregroundStyle(RrradioTheme.accent)
                    Text(detail)
                        .foregroundStyle(RrradioTheme.ink2)
                        .lineLimit(1)
                }
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.1)
                .frame(width: 86, alignment: .leading)
                .padding(.leading, 10)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if cancelTarget == .wake {
                    showingWakeAlarm = true
                }
            }

            Button {
                timerCancelConfirmation = cancelTarget
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 32, height: 32)
                    .overlay(Circle().stroke(RrradioTheme.line))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(cancelTarget == .wake ? locale.text(.unsetWakeAlarm) : locale.text(.cancelSleepTimer))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .frame(minHeight: 66)
        .background(RrradioTheme.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.accent)
                .frame(maxWidth: .infinity)
                .frame(height: 2)
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.accent)
                .frame(maxWidth: .infinity)
                .frame(height: 2)
        }
    }

    private func wakeStatusText(at date: Date) -> String {
        let remaining = WakeAlarm.formatCountdown(wakeAlarm.firesAt?.timeIntervalSince(date) ?? 0)
        return "\(remaining) . \(wakeAlarm.time)"
    }

    private func timerCapabilityStars(for station: Station?) -> some View {
        HStack(spacing: 1) {
            ForEach(0..<timerStarCount(for: station), id: \.self) { _ in
                Image(systemName: "star.fill")
                    .font(.system(size: 8))
            }
        }
        .foregroundStyle(RrradioTheme.stationStars)
    }

    private func timerStarCount(for station: Station?) -> Int {
        guard let station else { return 0 }
        return catalogCapabilityLevel(for: station)
    }

    private var emptyTitle: String {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty || hasActiveFilters {
            return locale.text(.noStationsFound)
        }
        switch source {
        case .all: return locale.text(.catalogEmpty)
        case .favorites: return locale.text(.noFavorites)
        case .recents: return locale.text(.noRecents)
        }
    }

    private var emptyIcon: String {
        if hasActiveFiltersForCurrentSource { return "line.3.horizontal.decrease.circle" }
        switch source {
        case .all: return "antenna.radiowaves.left.and.right.slash"
        case .favorites: return "heart"
        case .recents: return "clock"
        }
    }

    private var emptyDescription: String {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty || hasActiveFiltersForCurrentSource {
            return locale.text(.trySearch)
        }
        switch source {
        case .all: return locale.text(.catalogNoRows)
        case .favorites: return locale.text(.tapHeart)
        case .recents: return locale.text(.recentsHint)
        }
    }

    private var statusLabel: String {
        switch source {
        case .all:
            let filters = activeFilterLabels
            return filters.isEmpty ? locale.text(.allStations) : filters.joined(separator: " . ")
        case .favorites: return locale.text(.favorites)
        case .recents: return locale.text(.recents)
        }
    }

    private var statusCountLabel: String {
        guard source == .all else { return "\(filteredStations.count)" }
        if !checkedStarSelections.isEmpty { return "\(filteredStations.count)" }
        if hasActiveFilters || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "\(filteredStations.count)+"
        }
        return "\(radioBrowserTotalCount ?? filteredStations.count)"
    }

    private var activeFilterLabels: [String] {
        var labels: [String] = []
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            labels.append(locale.text(.search))
        }
        if !checkedStarSelections.isEmpty {
            let selectedStars = checkedStarSelections.sorted().map { $0 == 0 ? "-" : "\($0)" }.joined(separator: ", ")
            labels.append("Checked: \(selectedStars)")
        }
        labels.append(contentsOf: activeBrowseFilterLabels)
        return labels
    }

    private var activeBrowseFilterLabels: [String] {
        var labels: [String] = []
        if newsFilterSelected {
            labels.append(locale.text(.news))
        }
        for genre in genres where selectedGenreIDs.contains(genre.id) {
            labels.append(genre.label)
        }
        for country in selectedCountryCodes.sorted() {
            labels.append(country.uppercased())
        }
        return labels
    }

    private var canLoadWorldwideStations: Bool {
        source == .all && checkedStarSelections.isEmpty && radioBrowserHasMore
    }

    private func isCheckedStation(_ station: Station, selectedStars: Set<Int>) -> Bool {
        selectedStars.contains(checkedStarCount(for: station))
    }

    nonisolated private static func checkedStarCount(for station: Station) -> Int {
        catalogCapabilityLevel(for: station)
    }

    nonisolated private static func stationMatchesCheckedFilter(_ station: Station, selectedStars: Set<Int>) -> Bool {
        selectedStars.isEmpty || selectedStars.contains(checkedStarCount(for: station))
    }

    private func checkedStarCount(for station: Station) -> Int {
        Self.checkedStarCount(for: station)
    }

    private func resetStationDisplayLimit() {
        stationDisplayLimit = stationPageSize
    }

    private func resetRadioBrowserStations() {
        radioBrowserSearchTask?.cancel()
        radioBrowserStations = []
        radioBrowserOffset = 0
        radioBrowserHasMore = true
        radioBrowserLoading = false
    }

    private func recomputeFilteredStations() {
        let query = query
        let source = source
        let browseFiltersApply = source == .all
        let selectedCountryCodes = browseFiltersApply ? selectedCountryCodes : []
        let selectedGenreIDs = browseFiltersApply ? selectedGenreIDs : []
        let newsFilterSelected = browseFiltersApply ? newsFilterSelected : false
        let stations = stations
        let catalogStations = allStations
        let customStations = library.customStations
        let searchIndex = catalog.searchIndex
        let checkedStarSelections = browseFiltersApply ? checkedStarSelections : []
        let browseStationSort = source == .all ? browseStationSort : nil
        let favoriteIDs = Set(library.favorites.map(\.id))
        let radioBrowserStations = radioBrowserStations
        let searchResultLimit = searchResultLimit
        let stationPageSize = stationPageSize
        filterTask?.cancel()
        filterTask = Task.detached(priority: .userInitiated) {
            let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            let matches: [Station]
            let showFavoritesCatalogFallback: Bool
            if source == .all,
               !trimmedQuery.isEmpty,
               let searchIndex,
               Self.searchIndexCoversCurrentCatalog(searchIndex, catalogStations: catalogStations) {
                showFavoritesCatalogFallback = false
                let quickMatches = Self.searchIndexedStations(
                    query: trimmedQuery,
                    selectedCountryCodes: selectedCountryCodes,
                    selectedGenreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
                    checkedStarSelections: checkedStarSelections,
                    catalogStations: catalogStations,
                    customStations: customStations,
                    radioBrowserStations: radioBrowserStations,
                    searchIndex: searchIndex,
                    limit: stationPageSize,
                )
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    filteredStations = Self.sortedStations(
                        quickMatches,
                        sort: browseStationSort,
                        favoriteIDs: favoriteIDs,
                    )
                    showingFavoritesCatalogFallback = false
                }
                matches = Self.searchIndexedStations(
                    query: trimmedQuery,
                    selectedCountryCodes: selectedCountryCodes,
                    selectedGenreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
                    checkedStarSelections: checkedStarSelections,
                    catalogStations: catalogStations,
                    customStations: customStations,
                    radioBrowserStations: radioBrowserStations,
                    searchIndex: searchIndex,
                    limit: searchResultLimit,
                )
            } else {
                let favoriteMatches = source == .favorites && !trimmedQuery.isEmpty
                    ? stations.filter {
                        stationMatches($0, query: query)
                            && Self.stationMatchesBrowseFilters(
                                $0,
                                countryCodes: selectedCountryCodes,
                                genreIDs: selectedGenreIDs,
                                newsFilterSelected: newsFilterSelected,
                            )
                    }
                    : []
                showFavoritesCatalogFallback = source == .favorites
                    && !trimmedQuery.isEmpty
                    && favoriteMatches.isEmpty
                let searchStations: [Station]
                if showFavoritesCatalogFallback {
                    searchStations = catalogStations
                } else if source == .all && !trimmedQuery.isEmpty {
                    searchStations = Self.uniqueStations(stations + customStations)
                } else {
                    searchStations = stations
                }
                matches = searchStations.filter {
                    stationMatches($0, query: query)
                        && Self.stationMatchesBrowseFilters(
                            $0,
                            countryCodes: selectedCountryCodes,
                            genreIDs: selectedGenreIDs,
                            newsFilterSelected: newsFilterSelected,
                        )
                }
            }
            guard !Task.isCancelled else { return }
            let sortedMatches = Self.sortedStations(
                matches,
                sort: browseStationSort,
                favoriteIDs: favoriteIDs,
            )
            await MainActor.run {
                filteredStations = sortedMatches
                showingFavoritesCatalogFallback = showFavoritesCatalogFallback && !matches.isEmpty
            }
        }
    }

    nonisolated private static func sortedStations(
        _ stations: [Station],
        sort: BrowseStationSort?,
        favoriteIDs: Set<String>,
    ) -> [Station] {
        switch sort {
        case .alphabetAscending:
            stations.sorted(by: localizedStationSort)
        case .alphabetDescending:
            stations.sorted { lhs, rhs in
                let order = lhs.name.localizedCaseInsensitiveCompare(rhs.name)
                if order != .orderedSame { return order == .orderedDescending }
                return lhs.id.localizedCaseInsensitiveCompare(rhs.id) == .orderedDescending
            }
        case .favoritesAscending:
            stations.sorted { lhs, rhs in
                let lhsFavorite = favoriteIDs.contains(lhs.id)
                let rhsFavorite = favoriteIDs.contains(rhs.id)
                if lhsFavorite != rhsFavorite { return !lhsFavorite && rhsFavorite }
                return localizedStationSort(lhs, rhs)
            }
        case .favoritesDescending:
            stations.sorted { lhs, rhs in
                let lhsFavorite = favoriteIDs.contains(lhs.id)
                let rhsFavorite = favoriteIDs.contains(rhs.id)
                if lhsFavorite != rhsFavorite { return lhsFavorite && !rhsFavorite }
                return localizedStationSort(lhs, rhs)
            }
        case .qualityHigh:
            stations.sorted { lhs, rhs in
                let lhsScore = stationQualitySortValue(lhs)
                let rhsScore = stationQualitySortValue(rhs)
                if lhsScore != rhsScore { return lhsScore > rhsScore }
                return localizedStationSort(lhs, rhs)
            }
        case .qualityLow:
            stations.sorted { lhs, rhs in
                let lhsScore = stationQualitySortValue(lhs)
                let rhsScore = stationQualitySortValue(rhs)
                if lhsScore != rhsScore { return lhsScore < rhsScore }
                return localizedStationSort(lhs, rhs)
            }
        case nil:
            stations
        }
    }

    nonisolated private static func stationQualitySortValue(_ station: Station) -> Int {
        streamQualityLevel(codec: station.codec, bitrate: station.bitrate)
    }

    nonisolated private static func localizedStationSort(_ lhs: Station, _ rhs: Station) -> Bool {
        lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }

    nonisolated private static func searchIndexedStations(
        query: String,
        selectedCountryCodes: Set<String>,
        selectedGenreIDs: Set<String>,
        newsFilterSelected: Bool,
        checkedStarSelections: Set<Int>,
        catalogStations: [Station],
        customStations: [Station],
        radioBrowserStations: [Station],
        searchIndex: SearchIndex,
        limit: Int,
    ) -> [Station] {
        let stationsByID = Dictionary(uniqueKeysWithValues: catalogStations.map { ($0.id, $0) })
        let catalogMatches: [Station]
        do {
            catalogMatches = try searchIndex.search(query: query, limit: limit).compactMap { hit in
                guard let station = stationsByID[hit.stationID] else { return nil }
                guard stationMatchesCheckedFilter(station, selectedStars: checkedStarSelections) else { return nil }
                guard stationMatchesBrowseFilters(
                    station,
                    countryCodes: selectedCountryCodes,
                    genreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
                ) else { return nil }
                return station
            }
        } catch {
            diagnosticRecordAsync("search", "fts failed", details: ["error": String(describing: error)])
            let fallbackStations = uniqueStations(catalogStations + customStations + (checkedStarSelections.isEmpty ? radioBrowserStations : []))
            return fallbackStations.filter {
                stationMatchesCheckedFilter($0, selectedStars: checkedStarSelections)
                    && stationMatches($0, query: query)
                    && stationMatchesBrowseFilters(
                        $0,
                        countryCodes: selectedCountryCodes,
                        genreIDs: selectedGenreIDs,
                        newsFilterSelected: newsFilterSelected,
                    )
            }
        }

        let catalogSubstringMatches = catalogStations.filter {
            stationMatchesCheckedFilter($0, selectedStars: checkedStarSelections)
                && stationMatches($0, query: query)
                && stationMatchesBrowseFilters(
                    $0,
                    countryCodes: selectedCountryCodes,
                    genreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
                )
        }
        let sideMatches = (customStations + (checkedStarSelections.isEmpty ? radioBrowserStations : [])).filter {
            stationMatchesCheckedFilter($0, selectedStars: checkedStarSelections)
                && stationMatches($0, query: query)
                && stationMatchesBrowseFilters(
                    $0,
                    countryCodes: selectedCountryCodes,
                    genreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
                )
        }
        return Array(uniqueStations(catalogMatches + catalogSubstringMatches + sideMatches).prefix(limit))
    }

    nonisolated private static func stationMatchesBrowseFilters(
        _ station: Station,
        countryCodes: Set<String>,
        genreIDs: Set<String>,
        newsFilterSelected: Bool,
    ) -> Bool {
        if !countryCodes.isEmpty {
            guard let country = station.country?.uppercased(),
                  countryCodes.contains(country) else { return false }
        }
        if !genreIDs.isEmpty {
            guard genreIDs.contains(where: { id in
                guard let genre = findGenre(id) else { return false }
                return stationMatchesGenre(station, genre: genre)
            }) else { return false }
        }
        if newsFilterSelected {
            guard stationMatchesFilters(station, country: nil, tag: "news") else { return false }
        }
        return true
    }

    nonisolated private static func searchIndexCoversCurrentCatalog(
        _ searchIndex: SearchIndex,
        catalogStations: [Station],
    ) -> Bool {
        guard searchIndex.stationCount == catalogStations.count else { return false }
        return Set(catalogStations.map(\.id)) == searchIndex.stationIDs
    }

    nonisolated private static func uniqueStations(_ stations: [Station]) -> [Station] {
        var seen = Set<String>()
        return stations.filter { station in
            if seen.contains(station.id) { return false }
            seen.insert(station.id)
            return true
        }
    }

    private func loadMoreStations() {
        if visibleStations.count < filteredStations.count {
            stationDisplayLimit = min(stationDisplayLimit + stationPageSize, filteredStations.count)
            return
        }
        guard canLoadWorldwideStations, !radioBrowserLoading else { return }
        fetchRadioBrowserStations()
    }

    private func fetchInitialRadioBrowserPageIfNeeded() {
        guard source == .all,
              checkedStarSelections.isEmpty else { return }
        fetchRadioBrowserTotalCountIfNeeded()
        fetchRadioBrowserStations()
    }

    private func fetchRadioBrowserTotalCountIfNeeded() {
        guard radioBrowserTotalCount == nil else { return }
        Task {
            radioBrowserTotalCount = try? await radioBrowser.stationCount()
        }
    }

    private func fetchRadioBrowserStations() {
        guard canLoadWorldwideStations, !radioBrowserLoading else { return }
        radioBrowserLoading = true
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let tag = selectedGenreIDs.sorted().first.flatMap { findGenre($0)?.rbTag } ?? (newsFilterSelected ? "news" : nil)
        let country = selectedCountryCodes.sorted().first
        let radioBrowserQuery = Self.radioBrowserQuery(query, country: country)
        let existingIDs = Set(stationPool.map(\.id))
        radioBrowserSearchTask = Task {
            do {
                let fetched = try await radioBrowser.search(
                    query: radioBrowserQuery,
                    tag: tag,
                    country: country,
                    offset: radioBrowserOffset,
                )
                let fresh = fetched.filter { !existingIDs.contains($0.id) }
                radioBrowserStations.append(contentsOf: fresh)
                radioBrowserOffset += RadioBrowserClient.pageSize
                radioBrowserHasMore = !fetched.isEmpty
                recomputeFilteredStations()
                stationDisplayLimit += max(fresh.count, stationPageSize)
            } catch {
                radioBrowserHasMore = false
            }
            radioBrowserLoading = false
            radioBrowserSearchTask = nil
        }
    }

    nonisolated private static func radioBrowserQuery(_ query: String, country: String?) -> String? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if country != nil, normalizeForSearch(trimmed).count <= 2 {
            return nil
        }
        return trimmed
    }

    private var searchPlaceholder: String {
        switch source {
        case .all: return locale.text(.searchAll)
        case .favorites: return locale.text(.searchFavorites)
        case .recents: return locale.text(.searchRecents)
        }
    }

    private var themeIcon: String {
        colorScheme == .dark ? "moon" : "sun.max"
    }

    private func circularIconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            circularIconLabel(icon)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func circularIconLabel(_ icon: String) -> some View {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .medium))
            .frame(width: topbarControlSize, height: topbarControlSize)
            .foregroundStyle(RrradioTheme.ink3)
            .overlay(Circle().stroke(RrradioTheme.line))
    }

    private var countrySearchRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 22, alignment: .leading)
            TextField(locale.text(.searchCountries), text: $countrySearchText)
                .font(.system(size: 15))
                .foregroundStyle(RrradioTheme.ink)
                .tint(RrradioTheme.accent)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func filterPickerRow(
        _ title: String,
        selected: Bool,
        leadingText: String? = nil,
        leadingSystemImage: String? = nil,
        showsSeparator: Bool = true,
        action: @escaping () -> Void,
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let leadingText {
                    Text(leadingText)
                        .font(.system(size: 17))
                        .frame(width: 22, alignment: .leading)
                } else if let leadingSystemImage {
                    Image(systemName: leadingSystemImage)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink3)
                        .frame(width: 22, alignment: .leading)
                } else {
                    Color.clear
                        .frame(width: 22, height: 1)
                }
                Text(title)
                    .font(.system(size: 15))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                if showsSeparator {
                    Rectangle()
                        .fill(RrradioTheme.line)
                        .frame(height: 1)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func filterPickerStarsRow(
        starCount: Int,
        selected: Bool,
        action: @escaping () -> Void,
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Color.clear
                    .frame(width: 22, height: 1)
                if starCount == 0 {
                    Text("-")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink)
                } else {
                    HStack(spacing: 2) {
                        ForEach(0..<starCount, id: \.self) { _ in
                            Image(systemName: "star.fill")
                                .font(.system(size: 12, weight: .semibold))
                        }
                    }
                    .foregroundStyle(RrradioTheme.stationStars)
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
            }
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(starCount == 0 ? "No stars" : "\(starCount) \(starCount == 1 ? "star" : "stars")")
    }

    private func filterCell<Control: View>(_ label: String, @ViewBuilder control: () -> Control) -> some View {
        VStack(spacing: 5) {
            control()
            Text(label)
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.1)
                .foregroundStyle(RrradioTheme.ink3)
        }
    }

    private func circularFilterButton(icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            circularFilterLabel(icon: icon, active: active)
        }
        .buttonStyle(.plain)
    }

    private func dismissSearch() {
        searchUpdateTask?.cancel()
        query = searchText
        searchFocused = false
    }

    private func scheduleSearchUpdate(_ value: String) {
        searchUpdateTask?.cancel()
        searchUpdateTask = Task {
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                query = value
            }
        }
    }

    private func circularFilterLabel(icon: String, active: Bool) -> some View {
        Image(systemName: icon)
            .font(.system(size: 15, weight: .medium))
            .frame(width: 36, height: 36)
            .foregroundStyle(active ? RrradioTheme.bg : RrradioTheme.ink3)
            .background(active ? RrradioTheme.buttonFill : .clear)
            .overlay(Circle().stroke(active ? RrradioTheme.buttonFill : RrradioTheme.line))
            .clipShape(Circle())
    }
}

nonisolated private func catalogCapabilityLevel(for station: Station) -> Int {
    let status = station.status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if station.metadata != nil || status == "working" { return 4 }
    if status == "icy-only" { return 3 }
    if status == "stream-only" { return 2 }
    if status != nil { return 1 }
    return 0
}

struct StationRow: View {
    enum Mode {
        case standard
        case favoritesExpanded
    }

    let station: Station
    var nowPlaying: NowPlayingMetadata?
    var mode: Mode = .standard
    let isCurrent: Bool
    let isPlaying: Bool
    let isFavorite: Bool
    let isCustom: Bool
    let onPlay: () -> Void
    let onToggleFavorite: () -> Void
    var showsFavoriteButton = true
    var onInfoHoldChanged: ((Bool) -> Void)?
    @State private var showingStreamQuality = false
    @State private var infoPressRecognized = false
    @State private var suppressNextPlay = false
    private let trailingControlSize: CGFloat = 36
    private let trailingControlSpacing: CGFloat = 8
    private var rowContentTrailingPadding: CGFloat {
        mode == .standard ? 6 : 20
    }

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: mode == .favoritesExpanded ? 16 : 14) {
                rowArtwork
                rowText
                    .frame(maxWidth: .infinity, alignment: .leading)

                if mode == .favoritesExpanded, expandedArtworkURL != nil {
                    expandedCoverArtwork
                        .frame(width: 58, height: 58)
                        .layoutPriority(1)
                }
                if isPlaying && mode != .favoritesExpanded {
                    EqualizerView()
                }
            }
            .frame(minHeight: mode == .favoritesExpanded ? 58 : 38)
            .contentShape(Rectangle())
            .onTapGesture {
                if suppressNextPlay {
                    suppressNextPlay = false
                    return
                }
                onPlay()
            }
            .accessibilityAddTraits(.isButton)

            trailingControls
        }
        .padding(.leading, 20)
        .padding(.trailing, rowContentTrailingPadding)
        .padding(.vertical, mode == .favoritesExpanded ? 16 : 14)
        .alert("Stream quality", isPresented: $showingStreamQuality) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(streamQualityMessage)
        }
        .background {
            if mode == .standard {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(RrradioTheme.bg2)
            } else if isCurrent {
                LinearGradient(
                    colors: [RrradioTheme.ink.opacity(0.035), .clear],
                    startPoint: .leading,
                    endPoint: .trailing,
                )
            } else {
                RrradioTheme.bg
            }
        }
        .overlay(alignment: .leading) {
            if isCurrent {
                Rectangle()
                    .fill(RrradioTheme.accent)
                    .frame(width: 2)
            }
        }
        .overlay(alignment: .top) {
            if mode != .standard {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(maxWidth: .infinity)
                    .frame(height: 1)
            }
        }
        .padding(.horizontal, mode == .standard ? 14 : 0)
        .contentShape(Rectangle())
        .onLongPressGesture(
            minimumDuration: 0.36,
            maximumDistance: 24,
            pressing: { pressing in
                if !pressing {
                    handleInfoHoldChanged(false)
                }
            },
            perform: {
                handleInfoHoldChanged(true)
            },
        )
    }

    @ViewBuilder
    private var trailingControls: some View {
        if mode == .standard || showsFavoriteButton {
            HStack(spacing: trailingControlSpacing) {
                if mode == .standard {
                    streamQualityButton
                }

                if showsFavoriteButton {
                    favoriteButton
                }
            }
        }
    }

    @ViewBuilder
    private var streamQualityButton: some View {
        if hasStreamDetail {
            Button {
                showingStreamQuality = true
            } label: {
                qualityMeter
                    .frame(width: trailingControlSize, height: trailingControlSize, alignment: .center)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stream quality")
        } else {
            Color.clear
                .frame(width: trailingControlSize, height: trailingControlSize)
                .accessibilityHidden(true)
        }
    }

    private var favoriteButton: some View {
        Button(action: onToggleFavorite) {
            Image(systemName: isFavorite ? "heart.fill" : "heart")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(isFavorite ? RrradioTheme.favoriteFill : RrradioTheme.ink4)
                .frame(width: trailingControlSize, height: trailingControlSize)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isFavorite ? "Remove from favorites" : "Add to favorites")
    }

    private func handleInfoHoldChanged(_ isHolding: Bool) {
        guard let onInfoHoldChanged else { return }
        if isHolding {
            infoPressRecognized = true
            suppressNextPlay = true
        } else {
            if infoPressRecognized {
                suppressNextPlay = true
            }
            infoPressRecognized = false
            clearSuppressedPlaySoon()
        }
        onInfoHoldChanged(isHolding)
    }

    private func clearSuppressedPlaySoon() {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            suppressNextPlay = false
        }
    }

    @ViewBuilder
    private var rowArtwork: some View {
        let artworkSize: CGFloat = mode == .favoritesExpanded ? 46 : 38
        if isCustom {
            LocalStationArtworkView(size: artworkSize)
                .frame(width: artworkSize, height: artworkSize)
        } else {
            FaviconView(url: station.favicon, stationName: station.name, stationID: station.id, size: artworkSize)
                .frame(width: artworkSize, height: artworkSize)
        }
    }

    @ViewBuilder
    private var rowText: some View {
        if mode == .favoritesExpanded {
            VStack(alignment: .leading, spacing: 4) {
                stationTitleLine
                if let programInfoLine {
                    detailText(programInfoLine, style: .secondary)
                }
                if let trackLine {
                    detailText(trackLine, style: .primary)
                } else if let headlineLine {
                    detailText(headlineLine, style: .primary)
                }
                streamDetailView
            }
        } else {
            VStack(alignment: .leading, spacing: 3) {
                stationTitleLine
                if let trackLine {
                    Text(trackLine)
                        .font(.system(size: 11.5))
                        .foregroundStyle(RrradioTheme.ink2)
                        .lineLimit(1)
                } else if mode != .standard {
                    EmptyView()
                } else {
                    stationTagLine
                }
            }
        }
    }

    private var stationTitleLine: some View {
        HStack(spacing: 4) {
            HStack(spacing: 4) {
                Text(mode == .favoritesExpanded ? station.name : primaryLine)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                    .lineLimit(1)
                let flag = countryFlagEmoji(station.country)
                if !flag.isEmpty {
                    Text(flag)
                        .font(.system(size: 12))
                        .foregroundStyle(.primary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
        }
    }

    @ViewBuilder
    private var stationTagLine: some View {
        HStack(spacing: 6) {
            if isCustom {
                Text("added station")
                    .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .textCase(.lowercase)
                    .lineLimit(1)
            } else {
                capabilityStars
            }
            if !isCustom, let tags = station.tags, !tags.isEmpty {
                Text(tags.prefix(3).joined(separator: " . "))
                    .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .textCase(.lowercase)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private enum DetailTextStyle {
        case primary
        case secondary
        case mono
    }

    private func detailText(_ value: String, style: DetailTextStyle) -> some View {
        Text(value)
            .font(detailFont(for: style))
            .foregroundStyle(detailColor(for: style))
            .lineLimit(1)
    }

    private func detailFont(for style: DetailTextStyle) -> Font {
        switch style {
        case .primary:
            .system(size: 11.5)
        case .secondary:
            .system(size: 11.5)
        case .mono:
            .system(size: 10.5, weight: .regular, design: .monospaced)
        }
    }

    private func detailColor(for style: DetailTextStyle) -> Color {
        switch style {
        case .primary:
            RrradioTheme.ink2
        case .secondary, .mono:
            RrradioTheme.ink3
        }
    }

    private var expandedCoverArtwork: some View {
        NowPlayingArtworkThumb(
            url: nowPlaying?.coverUrl,
            size: 58,
        )
    }

    private var expandedArtworkURL: URL? {
        nowPlaying?.coverUrl
    }

    private var primaryLine: String {
        guard let program = clean(nowPlaying?.programName) else {
            return station.name
        }
        return "\(station.name) - \(program)"
    }

    private var trackLine: String? {
        guard let title = clean(nowPlaying?.title) else { return nil }
        if let artist = clean(nowPlaying?.artist) {
            return "\(artist) - \(title)"
        }
        return title
    }

    private var headlineLine: String? {
        guard let raw = clean(nowPlaying?.raw),
              raw != station.name,
              raw != programInfoLine else {
            return nil
        }
        return raw
    }

    private var programInfoLine: String? {
        [
            clean(nowPlaying?.programName),
            clean(nowPlaying?.programSubtitle),
        ]
        .compactMap { $0 }
        .joined(separator: " . ")
        .nilIfEmpty
    }

    @ViewBuilder
    private var streamDetailView: some View {
        if hasStreamDetail {
            HStack(spacing: 5) {
                detailText(streamDetailText, style: .mono)
                detailText(".", style: .mono)
                qualityMeter
            }
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var hasStreamDetail: Bool {
        station.codec?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false || station.bitrate != nil
    }

    private var streamDetailText: String {
        [
            station.codec?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().nilIfEmpty,
            station.bitrate.map { "\($0) kbps" },
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
    }

    private var streamQualityMessage: String {
        let detail = streamDetailText.isEmpty ? "Unknown codec and bitrate" : streamDetailText
        return "\(detail)\nQuality: \(streamQualityLevel(codec: station.codec, bitrate: station.bitrate))/4"
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private var capabilityStars: some View {
        HStack(spacing: 1) {
            ForEach(0..<starCount, id: \.self) { _ in
                Image(systemName: "star.fill")
                    .font(.system(size: 8))
            }
        }
        .foregroundStyle(RrradioTheme.stationStars)
    }

    private var starCount: Int {
        catalogCapabilityLevel(for: station)
    }

    private var qualityMeter: some View {
        let level = streamQualityLevel(codec: station.codec, bitrate: station.bitrate)
        let heights: [CGFloat] = [5, 8, 11, 14]
        return HStack(alignment: .bottom, spacing: 2.5) {
            ForEach(0..<4, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(index < level ? RrradioTheme.ink2 : RrradioTheme.ink4.opacity(0.24))
                    .frame(width: 3.5, height: heights[index])
            }
        }
        .frame(width: 22, height: 18, alignment: .bottom)
    }
}

struct EqualizerView: View {
    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<4, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(RrradioTheme.accent)
                    .frame(width: 2, height: [5, 14, 9, 12][index])
            }
        }
        .frame(width: 16, height: 14)
    }
}

struct NowPlayingArtworkThumb: View {
    let url: URL?
    let size: CGFloat

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(RrradioTheme.bg2)
            if let url {
                CachedRemoteImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFit()
                        .padding(3)
                } placeholder: {
                    Color.clear
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(RrradioTheme.line))
    }
}

private final class RemoteImageCache {
    static let shared = RemoteImageCache()

    private let cache = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    private init() {
        cache.countLimit = 800
        cache.totalCostLimit = 32 * 1024 * 1024
    }

    @MainActor
    func cachedImage(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    @MainActor
    func image(for url: URL) async -> UIImage? {
        if let cached = cachedImage(for: url) {
            return cached
        }
        if let task = inFlight[url] {
            return await task.value
        }

        let task = Task.detached(priority: .utility) { () async -> UIImage? in
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.timeoutInterval = 15

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                    return nil
                }
                guard let image = UIImage(data: data) else { return nil }
                return await image.byPreparingForDisplay() ?? image
            } catch {
                return nil
            }
        }

        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image {
            cache.setObject(image, forKey: url as NSURL, cost: image.cacheCost)
        }
        return image
    }
}

struct CachedRemoteImage<Content: View, Placeholder: View>: View {
    let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    @State private var image: UIImage?

    init(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder,
    ) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let image = image ?? cachedImage {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    @MainActor
    private var cachedImage: UIImage? {
        guard let url else { return nil }
        return RemoteImageCache.shared.cachedImage(for: url)
    }

    @MainActor
    private func loadImage() async {
        guard let url else {
            image = nil
            return
        }
        if let cached = RemoteImageCache.shared.cachedImage(for: url) {
            image = cached
            return
        }
        let loaded = await RemoteImageCache.shared.image(for: url)
        guard !Task.isCancelled else { return }
        image = loaded
    }
}

private extension UIImage {
    var cacheCost: Int {
        guard let cgImage else { return 1 }
        return cgImage.bytesPerRow * cgImage.height
    }
}

struct FaviconView: View {
    let url: URL?
    var stationName = ""
    var stationID = ""
    var size: CGFloat = 38

    var body: some View {
        ZStack {
            Circle()
                .fill(faviconPalette.background)
            if let url {
                CachedRemoteImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(RrradioTheme.line))
    }

    private var initials: some View {
        Text(stationInitials(stationName))
            .font(.system(size: max(13, size * 0.34), weight: .medium, design: .monospaced))
            .foregroundStyle(faviconPalette.foreground)
    }

    private var faviconPalette: (background: Color, foreground: Color) {
        (Color.white, Color.black)
    }
}

struct LocalStationArtworkView: View {
    var size: CGFloat = 38

    var body: some View {
        ZStack {
            Circle()
                .fill(RrradioTheme.bg2)
            Image(systemName: "house.fill")
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(RrradioTheme.line))
        .accessibilityHidden(true)
    }
}

private struct ScrollOffsetObserver: UIViewRepresentable {
    @Binding var offset: CGFloat
    var maximumOffset: CGFloat = .greatestFiniteMagnitude

    func makeCoordinator() -> Coordinator {
        Coordinator(offset: $offset, maximumOffset: maximumOffset)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        DispatchQueue.main.async {
            context.coordinator.attach(to: view)
        }
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.offset = $offset
        context.coordinator.maximumOffset = maximumOffset
        DispatchQueue.main.async {
            context.coordinator.attach(to: view)
        }
    }

    final class Coordinator: NSObject {
        var offset: Binding<CGFloat>
        var maximumOffset: CGFloat
        private weak var scrollView: UIScrollView?
        private var observation: NSKeyValueObservation?
        private var lastOffset: CGFloat = 0
        private var pendingOffset: CGFloat?
        private var offsetUpdateScheduled = false

        init(offset: Binding<CGFloat>, maximumOffset: CGFloat) {
            self.offset = offset
            self.maximumOffset = maximumOffset
        }

        func attach(to view: UIView) {
            attach(to: view, attempt: 0)
        }

        private func attach(to view: UIView, attempt: Int) {
            guard let scrollView = view.enclosingScrollView ?? view.window?.firstDescendantScrollView else {
                guard attempt < 8 else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self, weak view] in
                    guard let view else { return }
                    self?.attach(to: view, attempt: attempt + 1)
                }
                return
            }
            guard scrollView !== self.scrollView else { return }
            self.scrollView = scrollView
            observation = scrollView.observe(\.contentOffset, options: [.new]) { [weak self] scrollView, _ in
                self?.scheduleOffsetUpdate(from: scrollView)
            }
            scheduleOffsetUpdate(from: scrollView)
        }

        private func scheduleOffsetUpdate(from scrollView: UIScrollView) {
            pendingOffset = min(maximumOffset, max(0, scrollView.contentOffset.y + scrollView.adjustedContentInset.top))
            guard !offsetUpdateScheduled else { return }
            offsetUpdateScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self, let value = self.pendingOffset else { return }
                self.pendingOffset = nil
                self.offsetUpdateScheduled = false
                guard abs(self.lastOffset - value) > 0.5 else { return }
                self.lastOffset = value
                self.offset.wrappedValue = value
            }
        }
    }
}

private extension UIView {
    var enclosingScrollView: UIScrollView? {
        if let scrollView = self as? UIScrollView {
            return scrollView
        }
        return superview?.enclosingScrollView
    }

    var firstDescendantScrollView: UIScrollView? {
        if let scrollView = self as? UIScrollView {
            return scrollView
        }
        for subview in subviews {
            if let scrollView = subview.firstDescendantScrollView {
                return scrollView
            }
        }
        return nil
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

func stationInitials(_ name: String) -> String {
    let parts = name
        .map { character in
            character.isLetter || character.isNumber ? character : " "
        }
        .split(separator: " ")
    let letters = parts
        .prefix(2)
        .compactMap { $0.first }
        .map { String($0).uppercased() }
        .joined()
        .prefix(2)
    return letters.isEmpty ? ".." : String(letters)
}

private extension View {
    func topbarChrome(top: CGFloat, bottom: CGFloat) -> some View {
        padding(.horizontal, 20)
            .padding(.top, top)
            .padding(.bottom, bottom)
            .background(RrradioTheme.bg)
    }

    func collapsingTopbarDivider(opacity: CGFloat) -> some View {
        self
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
                    .opacity(opacity)
            }
    }
}
