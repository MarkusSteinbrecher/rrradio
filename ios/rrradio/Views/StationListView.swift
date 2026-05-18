import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum RrradioTheme {
    static var accent: Color { ThemeController.accentColor() }
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
    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

enum FavoritesDisplayMode: String, CaseIterable, Identifiable {
    case list
    case tiles
    case app

    static let storageKey = "rrradio.favorites.displayMode"
    static let orderStorageKey = "rrradio.favorites.displayModeOrder"
    static let visibleStorageKey = "rrradio.favorites.visibleDisplayModes"

    var id: String { rawValue }

    static var defaultOrder: [FavoritesDisplayMode] { [.list, .tiles, .app] }
    static var defaultRawValue: String { encode(defaultOrder) }

    var title: String {
        switch self {
        case .list: "List"
        case .tiles: "Tiles"
        case .app: "App"
        }
    }

    var detail: String {
        switch self {
        case .list: "Show stations as a list."
        case .tiles: "Show two station tiles per row."
        case .app: "Show station logos like iPhone apps."
        }
    }

    var systemImage: String {
        switch self {
        case .list: "list.bullet"
        case .tiles: "rectangle.grid.2x2"
        case .app: "square.grid.3x3"
        }
    }

    static func encode(_ modes: [FavoritesDisplayMode]) -> String {
        modes.map(\.rawValue).joined(separator: ",")
    }

    static func containsValidMode(in rawValue: String?) -> Bool {
        !decodedModes(from: rawValue).isEmpty
    }

    static func normalizedOrder(from rawValue: String?) -> [FavoritesDisplayMode] {
        var result: [FavoritesDisplayMode] = []
        for mode in decodedModes(from: rawValue) where !result.contains(mode) {
            result.append(mode)
        }
        for mode in defaultOrder where !result.contains(mode) {
            result.append(mode)
        }
        return result
    }

    static func normalizedOrderRawValue(_ rawValue: String?) -> String {
        encode(normalizedOrder(from: rawValue))
    }

    static func visibleModes(orderRawValue: String?, visibleRawValue: String?) -> [FavoritesDisplayMode] {
        let order = normalizedOrder(from: orderRawValue)
        let visible = decodedModes(from: visibleRawValue)
        let visibleSet = Set(visible.isEmpty ? order : visible)
        let result = order.filter { visibleSet.contains($0) }
        return result.isEmpty ? [order.first ?? .list] : result
    }

    static func normalizedVisibleRawValue(orderRawValue: String?, visibleRawValue: String?) -> String {
        encode(visibleModes(orderRawValue: orderRawValue, visibleRawValue: visibleRawValue))
    }

    static func normalizedSelection(
        rawValue: String?,
        orderRawValue: String?,
        visibleRawValue: String?,
    ) -> FavoritesDisplayMode {
        let visible = visibleModes(orderRawValue: orderRawValue, visibleRawValue: visibleRawValue)
        if let rawValue,
           let mode = FavoritesDisplayMode(rawValue: rawValue),
           visible.contains(mode) {
            return mode
        }
        return visible.first ?? .list
    }

    static func adjacentMode(
        to mode: FavoritesDisplayMode,
        direction: Int,
        orderRawValue: String?,
        visibleRawValue: String?,
    ) -> FavoritesDisplayMode? {
        let visible = visibleModes(orderRawValue: orderRawValue, visibleRawValue: visibleRawValue)
        guard let index = visible.firstIndex(of: mode) else { return nil }
        let targetIndex = index + direction
        guard visible.indices.contains(targetIndex) else { return nil }
        return visible[targetIndex]
    }

    static func rawValueByMoving(
        _ mode: FavoritesDisplayMode,
        by offset: Int,
        orderRawValue: String?,
    ) -> String {
        var order = normalizedOrder(from: orderRawValue)
        guard let index = order.firstIndex(of: mode) else { return encode(order) }
        let targetIndex = index + offset
        guard order.indices.contains(targetIndex) else { return encode(order) }
        order.swapAt(index, targetIndex)
        return encode(order)
    }

    static func rawValueBySettingVisibility(
        _ mode: FavoritesDisplayMode,
        visible isVisible: Bool,
        orderRawValue: String?,
        visibleRawValue: String?,
    ) -> String {
        let order = normalizedOrder(from: orderRawValue)
        var visible = visibleModes(orderRawValue: orderRawValue, visibleRawValue: visibleRawValue)
        if isVisible {
            if !visible.contains(mode) {
                visible.append(mode)
            }
        } else if visible.contains(mode), visible.count > 1 {
            visible.removeAll { $0 == mode }
        }
        let visibleSet = Set(visible)
        return encode(order.filter { visibleSet.contains($0) })
    }

    private static func decodedModes(from rawValue: String?) -> [FavoritesDisplayMode] {
        guard let rawValue else { return [] }
        return rawValue
            .split(separator: ",")
            .compactMap { FavoritesDisplayMode(rawValue: String($0)) }
    }
}

struct StationListView: View {
    @Binding private var tab: AppTab
    @Binding private var searchFocusedExternally: Bool
    @Binding private var browseStationListSelectionActiveExternally: Bool
    private let fixedTab: AppTab?
    private let horizontalSwipeLockedExternally: Bool
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(ThemeController.self) private var theme
    @Environment(LocaleController.self) private var locale
    @Environment(CloudSyncController.self) private var cloudSync
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @AppStorage(FavoritesDisplayMode.storageKey) private var favoritesDisplayModeRaw = FavoritesDisplayMode.list.rawValue
    @AppStorage(FavoritesDisplayMode.orderStorageKey) private var favoritesDisplayModeOrderRaw = FavoritesDisplayMode.defaultRawValue
    @AppStorage(FavoritesDisplayMode.visibleStorageKey) private var favoritesDisplayModeVisibleRaw = FavoritesDisplayMode.defaultRawValue
    @AppStorage(LibraryListSelection.storageKey) private var librarySelectionRaw = LibraryListSelection.home.rawValue
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
    @State private var draggedFavoriteStationID: String?
    @State private var targetedFavoriteStationID: String?
    // Timestamp of the last successful reorder during the active drag.
    // moveIfReady gates on a short interval since this stamp instead of
    // the previous "same target ID" lock, so dragging back and forth
    // across the same boundary lets fine adjustments through.
    @State private var lastFavoriteDropMoveAt: Date?
    @State private var favoriteDeleteModeEnabled = false
    @State private var filterTask: Task<Void, Never>?
    @State private var searchUpdateTask: Task<Void, Never>?
    @State private var radioBrowserSearchTask: Task<Void, Never>?
    @State private var favoriteNowPlaying = FavoriteNowPlayingStore()
    @State private var listScrollOffset: CGFloat = 0
    @State private var pageSwipeAxis: PageSwipeAxis?
    @State private var pageSwipeDragOffset: CGFloat = 0
    @State private var pageSwipeSettlingTarget: LibraryListSelection?
    @State private var suppressSwipeActivationUntil: Date?
    @State private var favoritesSearchPresented = false
    @State private var selectedStationListID: String?
    @State private var showingCreateStationList = false
    @State private var stationListDeleteModeEnabled = false
    @State private var stationListNameDraft = ""
    @State private var browseListSelectionActive = false
    @State private var browseListSelectedStationIDs: Set<String> = []
    @State private var browseListSelectedStationOrder: [String] = []
    @State private var browseListNameDraft = ""
    @State private var browseListTargetStationListID: String?
    @State private var showingBrowseListPicker = false
    @State private var stationInfoPreview: Station?
    @State private var stationInfoPreviewMetadata: [String: NowPlayingMetadata] = [:]
    @State private var stationInfoMetadataTask: Task<Void, Never>?
    @FocusState private var searchFocused: Bool

    private let stationPageSize = 220
    private let searchResultLimit = 5000
    private let favoriteTileGridColumnCount = 2
    private let favoriteAppGridColumnCount = 4
    private let browseControlsExpandedHeight: CGFloat = 20
    private var stickyHeaderPinnedOffset: CGFloat {
        stationHeaderTopPadding + browseControlsExpandedHeight + stationHeaderStackSpacing
    }
    private var stickyHeaderPinnedTopPadding: CGFloat {
        listScrollOffset >= stickyHeaderPinnedOffset ? stationHeaderStackSpacing : 0
    }
    private let pageSwipeThreshold: CGFloat = 58
    private let pageSwipeAxisLockThreshold: CGFloat = 12
    private let pageSwipeAxisLockRatio: CGFloat = 1.15
    private let pageSwipeDirectionTolerance: CGFloat = 0.55
    private let pageSwipeCompletionDuration: TimeInterval = 0.24
    private let swipeActivationSuppressionDuration: TimeInterval = 0.55
    private let topbarControlSize: CGFloat = 36
    private let topbarControlSpacing: CGFloat = 8
    private let favoriteRemoveControlTrailingInset: CGFloat = 20
    private let stationHeaderTopPadding: CGFloat = 6
    private let stationHeaderStackSpacing: CGFloat = 6
    private let libraryHeaderRuleTopPadding: CGFloat = 0
    private let libraryPageDotSize: CGFloat = 3.5
    private let libraryPageDotSpacing: CGFloat = 4
    private let libraryPageDotTitleSpacing: CGFloat = 8
    private let sortSideColumnWidth: CGFloat = 98
    // Centers the Browse list-selection icon above the standard row artwork.
    private let sortListSelectionControlLeadingSpacerWidth: CGFloat = 19
    private let sortListSelectionControlWidth: CGFloat = 28
    private let sortAlphabetControlWidth: CGFloat = 44
    private var stationScrollPinnedViews: PinnedScrollableViews {
        pageTab == .browse ? [.sectionHeaders] : []
    }

    private enum ActiveFilterPicker {
        case main
    }

    private enum BrowseFilterSection: String, CaseIterable, Identifiable {
        case genre
        case country

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

    init(
        tab: Binding<AppTab> = .constant(.browse),
        searchFocusedExternally: Binding<Bool> = .constant(false),
        browseStationListSelectionActiveExternally: Binding<Bool> = .constant(false),
        fixedTab: AppTab? = nil,
        horizontalSwipeLockedExternally: Bool = false,
    ) {
        _tab = tab
        _searchFocusedExternally = searchFocusedExternally
        _browseStationListSelectionActiveExternally = browseStationListSelectionActiveExternally
        self.fixedTab = fixedTab
        self.horizontalSwipeLockedExternally = horizontalSwipeLockedExternally
        _source = State(initialValue: .all)
    }

    private var allStations: [Station] { catalog.browseOrdered }
    private var stationPool: [Station] {
        allStations + radioBrowserStations
    }
    private var librarySelection: LibraryListSelection {
        LibraryListSelection(rawValue: librarySelectionRaw).normalized(for: library.stationLists)
    }
    private var librarySelections: [LibraryListSelection] {
        LibraryListSelection.orderedSelections(for: library.stationLists)
    }
    private var filterOptionStations: [Station] {
        isFavoritesPage ? library.favorites : allStations
    }
    private var countries: [String] { availableCountries(from: filterOptionStations) }
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
    private var countryPickerCountries: [String] {
        guard !selectedCountryCodes.isEmpty else { return filteredCountries }
        let selected = countries.filter { selectedCountryCodes.contains($0) }
        let missingSelected = selectedCountryCodes
            .filter { !countries.contains($0) }
            .sorted { countryDisplayName($0) < countryDisplayName($1) }
        let selectedCountries = selected + missingSelected
        let remaining = filteredCountries.filter { !selectedCountryCodes.contains($0) }
        return selectedCountries + remaining
    }
    private var genres: [Genre] { availableGenres(from: filterOptionStations) }

    private var stations: [Station] {
        if isStationListsDetail {
            return selectedStationList?.stations ?? []
        }
        if isLibraryPage {
            switch librarySelection {
            case .home:
                return []
            case .recents:
                return library.recents
            case .favorites:
                return library.favorites
            case .stationList:
                return selectedStationList?.stations ?? []
            }
        }
        switch source {
        case .all: return stationPool
        case .favorites: return library.favorites
        case .recents: return library.recents
        }
    }

    private var displayLimit: Int {
        min(stationDisplayLimit, filteredStations.count)
    }

    private var visibleStations: [Station] { Array(filteredStations.prefix(displayLimit)) }
    private var playbackQueueSource: StationPlaybackQueue.Source {
        if isStationListsDetail {
            return .stationList
        }
        if isFavoritesPage {
            return showingFavoritesCatalogFallback ? .browse : .favorites
        }
        if isLibraryRecentsPage {
            return .recents
        }
        if showingFavoritesCatalogFallback {
            return .browse
        }
        switch source {
        case .all:
            return .browse
        case .favorites:
            return .favorites
        case .recents:
            return .recents
        }
    }
    private var playbackQueueSourceID: String? {
        isStationListsDetail ? selectedStationList?.id : nil
    }
    private var favoritesDisplayMode: FavoritesDisplayMode {
        FavoritesDisplayMode.normalizedSelection(
            rawValue: favoritesDisplayModeRaw,
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
    }
    private var visibleFavoritesDisplayModes: [FavoritesDisplayMode] {
        FavoritesDisplayMode.visibleModes(
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
    }
    private var usesFavoritesRows: Bool {
        isFavoritesPage && !showingFavoritesCatalogFallback && favoritesDisplayMode == .list
    }
    private var settingsColorScheme: ColorScheme {
        theme.preferredColorScheme ?? colorScheme
    }
    private var brandLogoColorScheme: ColorScheme {
        switch theme.choice {
        case .system:
            theme.systemColorScheme
        case .light:
            .light
        case .dark:
            .dark
        }
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
    private var hasActiveFiltersForCurrentSource: Bool {
        ((pageTab == .browse && source == .all) || isFavoritesPage) && hasActiveFilters
    }
    private var hasActiveBrowseFilter: Bool {
        pageTab == .browse && (source == .recents || hasActiveFilters)
    }
    private var canUseBrowseListSelection: Bool {
        pageTab == .browse && source == .all
    }
    private var isBrowseListSelectionMode: Bool {
        canUseBrowseListSelection && browseListSelectionActive
    }
    private var canSaveBrowseListSelection: Bool {
        !browseListSelectedStationIDs.isEmpty
            && !browseListNameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    private var browseListSelectionCountLabel: String {
        "\(browseListSelectedStationIDs.count)"
    }
    private var selectedBrowseStationsForSave: [Station] {
        let stationLookup = Dictionary(uniqueKeysWithValues: Self.uniqueStations(
            filteredStations + visibleStations + stationPool + library.customStations + library.favorites + library.recents,
        ).map { ($0.id, $0) })
        return browseListSelectedStationOrder.compactMap { stationLookup[$0] }
    }
    private var browseListTargetStationList: StationList? {
        browseListTargetStationListID.flatMap { library.stationList(id: $0) }
    }
    private var isLibraryPage: Bool {
        pageTab == .library
    }
    private var isLibraryHome: Bool {
        isLibraryPage && librarySelection == .home
    }
    private var isFavoritesPage: Bool {
        isLibraryPage && librarySelection == .favorites
    }
    private var isLibraryRecentsPage: Bool {
        isLibraryPage && librarySelection == .recents
    }
    private var isStationListsPage: Bool {
        isLibraryPage
    }
    private var isStationListsDetail: Bool {
        isStationListsPage && selectedStationList != nil
    }
    private var selectedStationList: StationList? {
        librarySelection.stationListID.flatMap { library.stationList(id: $0) }
    }
    private var filteredStationLists: [StationList] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { return library.stationLists }
        return library.stationLists.filter { Self.stationListMatches($0, query: trimmedQuery) }
    }
    private var filteredLibrarySelections: [LibraryListSelection] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let overviewSelections = librarySelections.filter { $0 != .home }
        guard !trimmedQuery.isEmpty else { return overviewSelections }
        return overviewSelections.filter { selection in
            if librarySelectionTitle(selection).localizedCaseInsensitiveContains(trimmedQuery) {
                return true
            }
            switch selection {
            case .home:
                return false
            case .recents:
                return library.recents.contains { stationMatches($0, query: trimmedQuery) }
            case .favorites:
                return library.favorites.contains { stationMatches($0, query: trimmedQuery) }
            case .stationList(let id):
                guard let list = library.stationList(id: id) else { return false }
                return Self.stationListMatches(list, query: trimmedQuery)
            }
        }
    }
    private var stationListsSignature: String {
        library.stationLists.map { list in
            [
                list.id,
                list.name,
                list.stations.map(\.id).joined(separator: ","),
            ].joined(separator: ":")
        }.joined(separator: "\u{1e}")
    }
    private var pageTab: AppTab {
        fixedTab ?? tab
    }
    private var filterSignature: String {
        [
            "\(pageTab.navigationIndex)",
            source.rawValue,
            librarySelection.rawValue,
            query,
            stationListsSignature,
            selectedGenreIDs.sorted().joined(separator: ","),
            selectedCountryCodes.sorted().joined(separator: ","),
            newsFilterSelected ? "news" : "",
            browseStationSort?.rawValue ?? "",
            "\(catalog.browseOrdered.count)",
            "\(library.favorites.count)",
            "\(library.recents.count)",
            "\(library.customStations.count)",
            "\(radioBrowserStations.count)",
        ].joined(separator: "\u{1f}")
    }

    var body: some View {
        pageShellWithLifecycle
    }

    private var pageShellWithLifecycle: some View {
        pageShellWithPresentations
            .onAppear(perform: handleAppear)
            .onChange(of: tab, handleTabChange)
            .onChange(of: source, handleSourceChange)
            .onChange(of: librarySelectionRaw, handleLibrarySelectionChange)
            .onChange(of: query, handleQueryChange)
            .onChange(of: browseListSelectionActive, handleBrowseListSelectionActiveChange)
            .onChange(of: browseListNameDraft, handleBrowseListNameDraftChange)
            .onChange(of: searchText, handleSearchTextChange)
            .onChange(of: selectedCountryCodes, handleSelectedCountryCodesChange)
            .onChange(of: selectedGenreIDs, handleSelectedGenreIDsChange)
            .onChange(of: newsFilterSelected, handleNewsFilterSelectedChange)
            .onChange(of: filterSignature, handleFilterSignatureChange)
            .onChange(of: favoritesDisplayModeRaw, handleFavoritesDisplayModeChange)
            .onChange(of: favoritesDisplayModeOrderRaw, handleFavoritesDisplayConfigurationChange)
            .onChange(of: favoritesDisplayModeVisibleRaw, handleFavoritesDisplayConfigurationChange)
            .onChange(of: catalog.stations, handleCatalogStationsChange)
            .onChange(of: searchFocused, handleSearchFocusedChange)
            .onChange(of: horizontalSwipeLockedExternally, handleExternalSwipeLockChange)
            .onDisappear(perform: handleDisappear)
            .onChange(of: activeFilterPicker, handleActiveFilterPickerChange)
    }

    private var pageShellWithPresentations: some View {
        pageShell
            .background(RrradioTheme.bg)
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
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if isBrowseListSelectionMode {
                    browseListSelectionBar
                }
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
            .alert(locale.text(.createStationList), isPresented: $showingCreateStationList) {
                TextField(locale.text(.stationListName), text: $stationListNameDraft)
                Button(locale.text(.cancel), role: .cancel) {
                    stationListNameDraft = ""
                }
                Button(locale.text(.createStationList)) {
                    createStationListFromDraft()
                }
            }
            .confirmationDialog(locale.text(.chooseStationList), isPresented: $showingBrowseListPicker) {
                ForEach(library.stationLists) { list in
                    Button(list.name) {
                        selectBrowseListTarget(list)
                    }
                }
                Button(locale.text(.cancel), role: .cancel) {}
            }
    }

    private func pageSwipeGesture(pageWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 16, coordinateSpace: .local)
            .onChanged { value in
                updatePageSwipeOffset(value, pageWidth: pageWidth)
            }
            .onEnded { value in
                handlePageSwipe(value, pageWidth: pageWidth)
            }
    }

    private func updatePageSwipeOffset(_ value: DragGesture.Value, pageWidth: CGFloat) {
        guard canUsePageSwipe else {
            resetPageSwipeTracking()
            return
        }

        let horizontal = value.translation.width
        let vertical = value.translation.height
        updatePageSwipeAxis(horizontal: horizontal, vertical: vertical)
        guard pageSwipeAxis == .horizontal else {
            pageSwipeDragOffset = 0
            return
        }
        pageSwipeDragOffset = constrainedPageSwipeOffset(horizontal, pageWidth: pageWidth)
    }

    private func handlePageSwipe(_ value: DragGesture.Value, pageWidth: CGFloat) {
        guard canUsePageSwipe else {
            resetPageSwipeTracking()
            return
        }

        let horizontal = value.translation.width
        let vertical = value.translation.height
        updatePageSwipeAxis(horizontal: horizontal, vertical: vertical)
        guard pageSwipeAxis == .horizontal,
              isPageSwipeDirection(horizontal: horizontal, vertical: vertical) else {
            settlePageSwipe(to: nil, pageWidth: pageWidth)
            return
        }

        let offset = constrainedPageSwipeOffset(horizontal, pageWidth: pageWidth)
        let predictedOffset = constrainedPageSwipeOffset(value.predictedEndTranslation.width, pageWidth: pageWidth)
        let target: LibraryListSelection?
        if offset < 0 {
            target = shouldCompletePageSwipe(offset: offset, predictedOffset: predictedOffset, pageWidth: pageWidth)
                ? nextLibrarySelection
                : nil
        } else if offset > 0 {
            target = shouldCompletePageSwipe(offset: offset, predictedOffset: predictedOffset, pageWidth: pageWidth)
                ? previousLibrarySelection
                : nil
        } else {
            target = nil
        }
        settlePageSwipe(to: target, pageWidth: pageWidth)
    }

    private var canUsePageSwipe: Bool {
        isLibraryPage
            && !showingFavoritesCatalogFallback
            && activeFilterPicker == nil
            && stationInfoPreview == nil
            && !searchFocused
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !favoriteDeleteModeEnabled
            && !stationListDeleteModeEnabled
            && targetedFavoriteStationID == nil
            && pageSwipeSettlingTarget == nil
    }

    private var pageSwipeGestureMask: GestureMask {
        canUsePageSwipe ? .all : .none
    }

    private var isHorizontalPageSwipeLocked: Bool {
        canUsePageSwipe && pageSwipeAxis == .horizontal
    }

    private var isHorizontalSwipeLocked: Bool {
        horizontalSwipeLockedExternally || isHorizontalPageSwipeLocked
    }

    private func updatePageSwipeAxis(horizontal: CGFloat, vertical: CGFloat) {
        guard pageSwipeAxis == nil else { return }

        let absHorizontal = abs(horizontal)
        let absVertical = abs(vertical)
        guard max(absHorizontal, absVertical) >= pageSwipeAxisLockThreshold else { return }

        if absHorizontal > absVertical * pageSwipeAxisLockRatio {
            pageSwipeAxis = .horizontal
            suppressActivationsAfterSwipe()
        } else if absVertical > absHorizontal * pageSwipeAxisLockRatio {
            pageSwipeAxis = .vertical
        }
    }

    private func isPageSwipeDirection(horizontal: CGFloat, vertical: CGFloat) -> Bool {
        abs(horizontal) > abs(vertical) * pageSwipeDirectionTolerance
    }

    private func constrainedPageSwipeOffset(_ horizontal: CGFloat, pageWidth: CGFloat) -> CGFloat {
        let width = max(pageWidth, 1)
        if horizontal < 0 {
            guard nextLibrarySelection != nil else {
                return 0
            }
            return max(horizontal, -width)
        } else if horizontal > 0 {
            guard previousLibrarySelection != nil else {
                return 0
            }
            return min(horizontal, width)
        }
        return 0
    }

    private func shouldCompletePageSwipe(offset: CGFloat, predictedOffset: CGFloat, pageWidth: CGFloat) -> Bool {
        let width = max(pageWidth, 1)
        let distanceThreshold = max(pageSwipeThreshold, width * 0.28)
        let predictedThreshold = width * 0.42
        return abs(offset) >= distanceThreshold || abs(predictedOffset) >= predictedThreshold
    }

    private var nextLibrarySelection: LibraryListSelection? {
        adjacentLibrarySelection(direction: 1)
    }

    private var previousLibrarySelection: LibraryListSelection? {
        adjacentLibrarySelection(direction: -1)
    }

    private func adjacentLibrarySelection(direction: Int) -> LibraryListSelection? {
        let selections = librarySelections
        guard let index = selections.firstIndex(of: librarySelection) else { return nil }
        let targetIndex = index + direction
        guard selections.indices.contains(targetIndex) else { return nil }
        return selections[targetIndex]
    }

    private func settlePageSwipe(to target: LibraryListSelection?, pageWidth: CGFloat) {
        pageSwipeAxis = nil
        guard let target else {
            withAnimation(.snappy(duration: pageSwipeCompletionDuration)) {
                pageSwipeDragOffset = 0
            }
            return
        }

        let width = max(pageWidth, 1)
        let direction: CGFloat = target == nextLibrarySelection ? 1 : -1
        let rebasedOffset = constrainedPageSwipeOffset(pageSwipeDragOffset, pageWidth: width) + direction * width
        pageSwipeSettlingTarget = target
        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) {
            setLibrarySelection(target)
            pageSwipeDragOffset = rebasedOffset
        }
        withAnimation(.snappy(duration: pageSwipeCompletionDuration)) {
            pageSwipeDragOffset = 0
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + pageSwipeCompletionDuration) {
            guard pageSwipeSettlingTarget == target else { return }
            withTransaction(transaction) {
                pageSwipeDragOffset = 0
                pageSwipeSettlingTarget = nil
            }
        }
    }

    private func resetPageSwipeTracking() {
        pageSwipeAxis = nil
        pageSwipeDragOffset = 0
        pageSwipeSettlingTarget = nil
    }

    private func suppressActivationsAfterSwipe() {
        suppressSwipeActivationUntil = Date.now.addingTimeInterval(swipeActivationSuppressionDuration)
    }

    private func consumeSwipeSuppressedActivation() -> Bool {
        guard let until = suppressSwipeActivationUntil else { return false }
        suppressSwipeActivationUntil = nil
        return Date.now <= until
    }

    private func performSwipeSafeActivation(_ action: () -> Void) {
        guard !consumeSwipeSuppressedActivation() else { return }
        action()
    }

    private func handleAppear() {
        library.refreshFavorites(from: catalog.stations)
        syncLibrarySelectionState()
        recomputeFilteredStations()
        updateFavoriteNowPlayingPolling()
    }

    private func handleTabChange(_: AppTab, _ value: AppTab) {
        if value != .library {
            hideStationListDeleteMode(animated: false)
        }
        guard fixedTab == nil else {
            if fixedTab == value, fixedTab == .library {
                syncLibrarySelectionState()
            } else if fixedTab == .browse, value != .browse {
                cancelBrowseListSelection()
            }
            return
        }
        setSource(stationSource(for: value), animated: true)
    }

    private func handleSourceChange(_: StationSource, _ value: StationSource) {
        resetStationDisplayLimit()
        listScrollOffset = 0
        if value != .all {
            cancelBrowseListSelection()
        }
        guard fixedTab == nil else { return }
        let targetTab = appTab(for: value)
        guard targetTab != tab else { return }
        tab = targetTab
    }

    private func handleLibrarySelectionChange(_: String, _: String) {
        applyLibrarySelectionChange()
    }

    private func handleQueryChange(_: String, _: String) {
        hideStationListDeleteMode(animated: false)
        resetStationDisplayLimit()
        resetRadioBrowserStations()
        fetchInitialRadioBrowserPageIfNeeded()
    }

    private func handleBrowseListSelectionActiveChange(_: Bool, _ active: Bool) {
        browseStationListSelectionActiveExternally = active
    }

    private func handleBrowseListNameDraftChange(_: String, _ value: String) {
        clearBrowseListTargetIfNameChanged(value)
    }

    private func handleSearchTextChange(_: String, _ value: String) {
        if !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            hideStationListDeleteMode(animated: false)
        }
        scheduleSearchUpdate(value)
    }

    private func handleSelectedCountryCodesChange(_: Set<String>, _: Set<String>) {
        resetStationDisplayLimit()
        resetRadioBrowserStations()
        fetchInitialRadioBrowserPageIfNeeded()
    }

    private func handleSelectedGenreIDsChange(_: Set<String>, _: Set<String>) {
        resetStationDisplayLimit()
        resetRadioBrowserStations()
        fetchInitialRadioBrowserPageIfNeeded()
    }

    private func handleNewsFilterSelectedChange(_: Bool, _: Bool) {
        resetStationDisplayLimit()
        resetRadioBrowserStations()
        fetchInitialRadioBrowserPageIfNeeded()
    }

    private func handleFilterSignatureChange(_: String, _: String) {
        recomputeFilteredStations()
        updateFavoriteNowPlayingPolling()
    }

    private func handleFavoritesDisplayModeChange(_: String, _: String) {
        listScrollOffset = 0
        hideFavoriteDeleteMode(animated: false)
        resetPageSwipeTracking()
        updateFavoriteNowPlayingPolling()
    }

    private func handleFavoritesDisplayConfigurationChange(_: String, _: String) {
        let normalized = favoritesDisplayMode
        if favoritesDisplayModeRaw != normalized.rawValue {
            favoritesDisplayModeRaw = normalized.rawValue
        }
        handleFavoritesDisplayModeChange("", "")
    }

    private func handleCatalogStationsChange(_: [Station], _ stations: [Station]) {
        library.refreshFavorites(from: stations)
        recomputeFilteredStations()
        updateFavoriteNowPlayingPolling()
    }

    private func handleSearchFocusedChange(_: Bool, _ focused: Bool) {
        searchFocusedExternally = focused
    }

    private func handleExternalSwipeLockChange(_: Bool, _ locked: Bool) {
        if locked {
            suppressActivationsAfterSwipe()
        }
    }

    private func handleActiveFilterPickerChange(_: ActiveFilterPicker?, _ picker: ActiveFilterPicker?) {
        if picker == nil {
            pendingBrowseFilterState = nil
        }
    }

    private func handleDisappear() {
        filterTask?.cancel()
        searchUpdateTask?.cancel()
        radioBrowserSearchTask?.cancel()
        stationInfoMetadataTask?.cancel()
        favoriteNowPlaying.stop()
        cancelBrowseListSelection()
        hideStationListDeleteMode(animated: false)
        searchFocusedExternally = false
    }

    private var pageShell: some View {
        VStack(spacing: 0) {
            topbar
            switch catalog.state {
            case .idle, .loading:
                if pageTab == .browse && source == .all && catalog.stations.isEmpty {
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
                if pageTab == .browse && source == .all {
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
    }

    private func setSource(_ newSource: StationSource, animated _: Bool) {
        guard source != newSource else { return }
        source = newSource
    }

    private func setLibrarySelection(_ selection: LibraryListSelection) {
        let normalized = selection.normalized(for: library.stationLists)
        guard librarySelectionRaw != normalized.rawValue else { return }
        dismissSearch()
        activeFilterPicker = nil
        librarySelectionRaw = normalized.rawValue
        applyLibrarySelectionChange()
    }

    private func applyLibrarySelectionChange() {
        syncLibrarySelectionState()
        resetStationDisplayLimit()
        listScrollOffset = 0
        resetPageSwipeTracking()
        hideFavoriteDeleteMode(animated: false)
        hideStationListDeleteMode(animated: false)
        recomputeFilteredStations()
        updateFavoriteNowPlayingPolling()
    }

    private func syncLibrarySelectionState() {
        let normalized = librarySelection
        if librarySelectionRaw != normalized.rawValue {
            librarySelectionRaw = normalized.rawValue
            return
        }
        selectedStationListID = normalized.stationListID
        switch normalized {
        case .recents:
            source = .recents
        case .favorites:
            source = .favorites
        case .home, .stationList:
            source = .all
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
        if pageTab == .browse {
            source = .all
        }
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
        player.play(station, queue: playbackQueue(for: station))
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

    private func clearBrowseFilters() {
        selectedGenreIDs = []
        selectedCountryCodes = []
        newsFilterSelected = false
    }

    private var currentBrowseFilterState: BrowseFilterState {
        BrowseFilterState(
            source: source,
            genreIDs: selectedGenreIDs,
            countryCodes: selectedCountryCodes,
            newsSelected: newsFilterSelected,
        )
    }

    private func openBrowseFilterWidget() {
        collapseFavoritesSearch()
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

    private func stationSource(for tab: AppTab) -> StationSource {
        switch tab {
        case .browse:
            return .all
        case .library:
            switch librarySelection {
            case .recents:
                return .recents
            case .favorites:
                return .favorites
            case .home, .stationList:
                return .all
            }
        }
    }

    private func appTab(for source: StationSource) -> AppTab {
        switch source {
        case .all:
            return .browse
        case .favorites:
            return .library
        case .recents:
            return .browse
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
        }
        .topbarChrome(top: 14, bottom: 0)
    }

    private var compactTopbar: some View {
        VStack(spacing: 8) {
            brandActionsRow
            searchAndFilterRow
                .frame(minWidth: 220, maxWidth: .infinity)
        }
        .topbarChrome(top: 8, bottom: 0)
    }

    private var favoritesDisplayModeSelector: some View {
        HStack(spacing: 4) {
            ForEach(visibleFavoritesDisplayModes, id: \.self) { mode in
                let selected = favoritesDisplayMode == mode
                Button {
                    setFavoritesDisplayMode(mode)
                } label: {
                    Image(systemName: mode.systemImage)
                        .font(.system(size: 13, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? RrradioTheme.bg : RrradioTheme.ink3)
                        .frame(width: topbarControlSize, height: topbarControlSize - 6)
                        .background(selected ? RrradioTheme.buttonFill : .clear)
                        .clipShape(Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(mode.title) Library view")
            }
        }
        .padding(3)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
        .frame(width: favoritesDisplayModeSelectorWidth, height: topbarControlSize)
    }

    private func setFavoritesDisplayMode(_ mode: FavoritesDisplayMode) {
        guard visibleFavoritesDisplayModes.contains(mode) else { return }
        guard favoritesDisplayMode != mode else { return }
        favoritesDisplayModeRaw = mode.rawValue
        cloudSync.noteSettingsChanged()
    }

    private var favoritesDisplayModeSelectorWidth: CGFloat {
        let itemCount = CGFloat(visibleFavoritesDisplayModes.count)
        let itemSpacing = CGFloat(max(visibleFavoritesDisplayModes.count - 1, 0)) * 4
        return itemCount * topbarControlSize + itemSpacing + 6
    }

    private var favoriteRemoveControlSlotWidth: CGFloat {
        topbarControlSize + favoriteRemoveControlTrailingInset
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

    private var headerRule: some View {
        Rectangle()
            .fill(RrradioTheme.line)
            .frame(height: 1)
            .accessibilityHidden(true)
    }

    private func inlineHeaderControls<Controls: View>(
        topPadding: CGFloat,
        includesRule: Bool,
        @ViewBuilder controls: () -> Controls,
    ) -> some View {
        VStack(spacing: includesRule ? 6 : 0) {
            controls()
                .frame(height: browseControlsExpandedHeight, alignment: .center)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 20)
            if includesRule {
                headerRule
            }
        }
        .padding(.top, topPadding)
        .padding(.bottom, includesRule ? 4 : 0)
        .frame(maxWidth: .infinity)
    }

    private var inlineBrowseControls: some View {
        inlineHeaderControls(topPadding: 0, includesRule: false) {
            secondaryBrowseControls
        }
    }

    private func inlineFavoritesControls(topPadding: CGFloat = 0) -> some View {
        inlineLibraryControls(for: librarySelection, topPadding: topPadding)
    }

    private func inlineStationListsControls(topPadding: CGFloat = 0) -> some View {
        inlineLibraryControls(for: librarySelection, topPadding: topPadding)
    }

    private func libraryPreviewInlineControls(for selection: LibraryListSelection) -> some View {
        inlineLibraryControls(for: selection)
    }

    private func inlineLibraryControls(for selection: LibraryListSelection, topPadding: CGFloat = 0) -> some View {
        inlineHeaderControls(topPadding: topPadding, includesRule: false) {
            ZStack {
                libraryPageStatus(for: selection)
                HStack {
                    if selection != .home {
                        libraryPagesButton
                    }
                    Spacer()
                    libraryDeleteModeButton(for: selection)
                }
            }
        }
    }

    private func libraryPageStatus(for selection: LibraryListSelection) -> some View {
        let pageIndex = librarySelections.firstIndex(of: selection) ?? 0
        let trailingDotCount = max(librarySelections.count - pageIndex - 1, 0)
        return Text(librarySelectionTitle(selection))
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.5)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .foregroundStyle(RrradioTheme.ink3)
            .overlay(alignment: .leading) {
                libraryPageDots(count: pageIndex)
                    .offset(x: -libraryPageDotsWidth(count: pageIndex) - libraryPageDotTitleSpacing)
            }
            .overlay(alignment: .trailing) {
                libraryPageDots(count: trailingDotCount)
                    .offset(x: libraryPageDotsWidth(count: trailingDotCount) + libraryPageDotTitleSpacing)
            }
            .frame(maxWidth: .infinity, minHeight: 20, alignment: .center)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(librarySelectionTitle(selection)), page \(pageIndex + 1) of \(librarySelections.count)")
    }

    private func libraryPageDots(count: Int) -> some View {
        HStack(spacing: libraryPageDotSpacing) {
            ForEach(0..<count, id: \.self) { _ in
                Circle()
                    .fill(RrradioTheme.ink4)
                    .frame(width: libraryPageDotSize, height: libraryPageDotSize)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: libraryPageDotsWidth(count: count), height: 8)
    }

    private func libraryPageDotsWidth(count: Int) -> CGFloat {
        guard count > 0 else { return 0 }
        return CGFloat(count) * libraryPageDotSize + CGFloat(count - 1) * libraryPageDotSpacing
    }

    private var libraryPagesButton: some View {
        Button {
            setLibrarySelection(.home)
        } label: {
            Image(systemName: "arrow.left")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show Library pages")
    }

    private var stationListBackButton: some View {
        Button {
            closeStationListDetail()
        } label: {
            Image(systemName: "house")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(locale.text(.stationLists))
    }

    private var showsFavoriteDeleteModeButton: Bool {
        showsFavoriteDeleteModeButton(for: librarySelection)
    }

    private func showsFavoriteDeleteModeButton(for selection: LibraryListSelection) -> Bool {
        selection == .favorites
            && !showingFavoritesCatalogFallback
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !hasActiveFilters
            && !library.favorites.isEmpty
    }

    private var showsStationListDeleteModeButton: Bool {
        showsStationListDeleteModeButton(for: librarySelection)
    }

    private func showsStationListDeleteModeButton(for selection: LibraryListSelection) -> Bool {
        switch selection {
        case .home:
            return !library.stationLists.isEmpty
                && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .stationList(let id):
            return library.stationList(id: id)?.stations.isEmpty == false
                && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .favorites, .recents:
            return false
        }
    }

    private var stationListDeleteModeAccessibilityLabel: String {
        stationListDeleteModeAccessibilityLabel(for: librarySelection)
    }

    private func stationListDeleteModeAccessibilityLabel(for selection: LibraryListSelection) -> String {
        let isStationList = selection.stationListID != nil
        if stationListDeleteModeEnabled {
            return isStationList ? "Done removing stations" : "Done removing lists"
        }
        return isStationList ? "Remove stations from list" : "Remove lists"
    }

    @ViewBuilder
    private func libraryDeleteModeButton(for selection: LibraryListSelection) -> some View {
        switch selection {
        case .favorites:
            if showsFavoriteDeleteModeButton(for: selection) {
                favoriteDeleteModeButton
            } else {
                disabledLibraryDeleteModeButton(label: "Remove favorites")
            }
        case .home, .stationList:
            if showsStationListDeleteModeButton(for: selection) {
                stationListDeleteModeButton
            } else {
                disabledLibraryDeleteModeButton(label: stationListDeleteModeAccessibilityLabel(for: selection))
            }
        case .recents:
            disabledLibraryDeleteModeButton(label: "Remove recents")
        }
    }

    private func disabledLibraryDeleteModeButton(label: String) -> some View {
        Button {} label: {
            Image(systemName: "trash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink4)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(true)
        .accessibilityLabel(label)
    }

    private var favoriteDeleteModeButton: some View {
        Button {
            toggleFavoriteDeleteMode()
        } label: {
            Image(systemName: favoriteDeleteModeEnabled ? "minus.circle" : "trash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(favoriteDeleteModeEnabled ? "Done removing favorites" : "Remove favorites")
    }

    private var stationListDeleteModeButton: some View {
        Button {
            toggleStationListDeleteMode()
        } label: {
            Image(systemName: stationListDeleteModeEnabled ? "minus.circle" : "trash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(stationListDeleteModeAccessibilityLabel)
    }

    private var brandActionsRow: some View {
        HStack(alignment: .center) {
            Button {
                searchText = ""
                query = ""
                searchFocused = false
                favoritesSearchPresented = false
                selectedStationListID = nil
                if pageTab != .browse {
                    tab = .browse
                } else {
                    source = .all
                }
                clearBrowseFilters()
                browseStationSort = nil
                activeFilterPicker = nil
            } label: {
                Image("RrradioLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .environment(\.colorScheme, brandLogoColorScheme)
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

    private func searchField(collapsed: Bool = false) -> some View {
        HStack(spacing: collapsed ? 0 : 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)

            if !collapsed {
                TextField(searchPlaceholder, text: $searchText)
                    .font(.system(size: 16))
                    .foregroundStyle(RrradioTheme.ink)
                    .tint(RrradioTheme.accent)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($searchFocused)
                    .onSubmit {
                        searchUpdateTask?.cancel()
                        query = searchText
                        searchFocused = false
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
        }
        .padding(.leading, collapsed ? 0 : 12)
        .padding(.trailing, collapsed ? 0 : 6)
        .frame(width: collapsed ? topbarControlSize : nil, height: topbarControlSize)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
        .contentShape(Capsule())
        .onTapGesture {
            if collapsed {
                expandFavoritesSearch()
            }
        }
        .onChange(of: searchFocused) { _, focused in
            if focused {
                activeFilterPicker = nil
            } else if isLibraryPage && searchText.isEmpty {
                favoritesSearchPresented = false
            }
        }
    }

    @ViewBuilder
    private var searchAndFilterRow: some View {
        if isLibraryPage {
            libraryTopbarControlRow
        } else {
            HStack(spacing: topbarControlSpacing) {
                searchField()
                    .frame(maxWidth: .infinity)
                filterPill
            }
        }
    }

    private var favoritesSearchExpanded: Bool {
        isLibraryPage && (favoritesSearchPresented || searchFocused || !searchText.isEmpty)
    }

    private func expandFavoritesSearch() {
        favoritesSearchPresented = true
        activeFilterPicker = nil
        Task { @MainActor in
            await Task.yield()
            searchFocused = true
        }
    }

    private func collapseFavoritesSearch() {
        searchFocused = false
        if searchText.isEmpty {
            favoritesSearchPresented = false
        }
    }

    private var filterPillWidth: CGFloat {
        hasActiveBrowseFilter ? topbarControlSize * 2 + topbarControlSpacing : topbarControlSize
    }

    private var libraryTopbarControlRow: some View {
        GeometryReader { proxy in
            let availableWidth = proxy.size.width
            let selectorLeading = max(
                0,
                (availableWidth - favoritesDisplayModeSelectorWidth) / 2
            )
            let maximumSearchWidth = max(
                topbarControlSize,
                selectorLeading - topbarControlSpacing
            )
            let searchWidth = favoritesSearchExpanded ? maximumSearchWidth : topbarControlSize

            ZStack {
                HStack(spacing: topbarControlSpacing) {
                    searchField(collapsed: !favoritesSearchExpanded)
                        .frame(width: searchWidth)

                    Spacer(minLength: 0)

                    circularIconButton("plus", label: locale.text(.createStationList)) {
                        openCreateStationListDialog()
                    }
                }

                favoritesDisplayModeSelector
            }
        }
        .frame(height: topbarControlSize)
        .animation(.snappy(duration: 0.18), value: favoritesSearchExpanded)
    }

    private func librarySelectionTitle(_ selection: LibraryListSelection) -> String {
        switch selection {
        case .home:
            return "Home"
        case .recents:
            return locale.text(.recents)
        case .favorites:
            return locale.text(.favorites)
        case .stationList(let id):
            return library.stationList(id: id)?.name ?? locale.text(.stationLists)
        }
    }

    private func librarySelectionIcon(_ selection: LibraryListSelection) -> String {
        switch selection {
        case .home:
            return "square.grid.2x2"
        case .recents:
            return "clock"
        case .favorites:
            return "heart"
        case .stationList:
            return "list.bullet.rectangle"
        }
    }

    @ViewBuilder
    private var browseSortRow: some View {
        if showsBrowseSortControls {
            HStack(spacing: 0) {
                HStack(spacing: 0) {
                    Color.clear
                        .frame(width: sortListSelectionControlLeadingSpacerWidth, height: 1)
                        .accessibilityHidden(true)
                    browseListSelectionModeButton
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
                            ForEach(countryPickerCountries, id: \.self) { code in
                                filterPickerRow("\(countryDisplayName(code)) (\(code))", selected: selectedCountryCodes.contains(code), leadingText: countryFlagEmoji(code)) {
                                    applyCountryFilter(code)
                                }
                            }
                        }

                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 6)

                HStack(spacing: 10) {
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
                .frame(maxWidth: .infinity, alignment: .center)
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
        Group {
            if isLibraryPage {
                libraryPageStatus(for: librarySelection)
            } else {
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
        }
    }

    private var statusToolbar: some View {
        sectionStatus
    }

    private var showsStatusLabel: Bool {
        if isLibraryPage { return true }
        switch source {
        case .all:
            return !activeFilterLabels.isEmpty
        case .favorites, .recents:
            return true
        }
    }

    private var statusLabelColor: Color {
        hasActiveFiltersForCurrentSource && !activeBrowseFilterLabels.isEmpty ? RrradioTheme.accent : RrradioTheme.ink3
    }

    private var showsBrowseSortControls: Bool {
        pageTab == .browse && source == .all
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

    private var browseListSelectionModeButton: some View {
        Button {
            toggleBrowseListSelectionMode()
        } label: {
            Image(systemName: "list.bullet.rectangle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isBrowseListSelectionMode ? RrradioTheme.accent : RrradioTheme.ink3)
                .frame(width: sortListSelectionControlWidth, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(locale.text(.addStationsToList))
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
            if isLibraryPage {
                libraryContent
            } else if filteredStations.isEmpty {
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
        stationScrollList
    }

    @ViewBuilder
    private var libraryContent: some View {
        GeometryReader { proxy in
            let pageWidth = max(proxy.size.width, 1)
            let activeOffset = constrainedPageSwipeOffset(pageSwipeDragOffset, pageWidth: pageWidth)
            let currentIndex = librarySelections.firstIndex(of: librarySelection) ?? 0
            ZStack {
                ForEach(Array(librarySelections.enumerated()), id: \.element) { index, selection in
                    libraryPageContent(for: selection, isActive: selection == librarySelection)
                        .frame(width: pageWidth, height: proxy.size.height)
                        .offset(x: CGFloat(index - currentIndex) * pageWidth + activeOffset)
                        .allowsHitTesting(selection == librarySelection && pageSwipeSettlingTarget == nil)
                        .zIndex(selection == librarySelection ? 1 : 0)
                }
            }
            .frame(width: pageWidth, height: proxy.size.height)
            .clipped()
            .contentShape(Rectangle())
            .simultaneousGesture(pageSwipeGesture(pageWidth: pageWidth), including: pageSwipeGestureMask)
        }
    }

    @ViewBuilder
    private func libraryPageContent(for selection: LibraryListSelection, isActive: Bool) -> some View {
        if isActive {
            activeLibraryContent
        } else {
            libraryPreviewContent(for: selection)
        }
    }

    @ViewBuilder
    private var activeLibraryContent: some View {
        if isLibraryHome {
            libraryOverview
        } else if filteredStations.isEmpty {
            ContentUnavailableView(
                emptyTitle,
                systemImage: emptyIcon,
                description: Text(emptyDescription),
            )
            .foregroundStyle(RrradioTheme.ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            libraryDisplayContent
        }
    }

    @ViewBuilder
    private func libraryPreviewContent(for selection: LibraryListSelection) -> some View {
        if selection == .home {
            libraryPreviewOverview
        } else {
            let stations = libraryPreviewStations(for: selection)
            if stations.isEmpty {
                ContentUnavailableView(
                    libraryEmptyTitle(for: selection),
                    systemImage: libraryEmptyIcon(for: selection),
                    description: Text(libraryEmptyDescription(for: selection)),
                )
                .foregroundStyle(RrradioTheme.ink)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                libraryPreviewDisplayView(selection: selection, stations: stations)
            }
        }
    }

    private var libraryPreviewOverview: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: stationHeaderStackSpacing) {
                libraryPreviewInlineControls(for: .home)

                Section {
                    ForEach(filteredLibrarySelections) { selection in
                        libraryOverviewCard(selection)
                            .padding(.horizontal, 14)
                            .padding(.top, selection == filteredLibrarySelections.first ? stationHeaderStackSpacing : 0)
                    }
                } header: {
                    stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                }
            }
            .padding(.top, stationHeaderTopPadding)
            .padding(.bottom, 12)
        }
        .scrollDisabled(true)
        .background(RrradioTheme.bg)
    }

    private var libraryDisplayContent: some View {
        libraryDisplayView(for: libraryDisplayMode(for: librarySelection))
    }

    private func libraryDisplayMode(for selection: LibraryListSelection) -> FavoritesDisplayMode {
        selection == .home ? .list : favoritesDisplayMode
    }

    private func libraryPreviewStations(for selection: LibraryListSelection) -> [Station] {
        let stations: [Station]
        switch selection {
        case .home:
            stations = []
        case .recents:
            stations = library.recents
        case .favorites:
            stations = library.favorites
        case .stationList(let id):
            stations = library.stationList(id: id)?.stations ?? []
        }
        return Array(stations.prefix(min(stationDisplayLimit, stations.count)))
    }

    private func libraryEmptyTitle(for selection: LibraryListSelection) -> String {
        switch selection {
        case .home:
            return locale.text(.noStationLists)
        case .recents:
            return locale.text(.noRecents)
        case .favorites:
            return locale.text(.noFavorites)
        case .stationList:
            return locale.text(.emptyStationList)
        }
    }

    private func libraryEmptyIcon(for selection: LibraryListSelection) -> String {
        switch selection {
        case .home:
            return "square.grid.2x2"
        case .recents:
            return "clock"
        case .favorites:
            return "heart"
        case .stationList:
            return "antenna.radiowaves.left.and.right.slash"
        }
    }

    private func libraryEmptyDescription(for selection: LibraryListSelection) -> String {
        switch selection {
        case .home:
            return locale.text(.stationListsHint)
        case .recents:
            return locale.text(.recentsHint)
        case .favorites:
            return locale.text(.tapHeart)
        case .stationList:
            return locale.text(.emptyStationListHint)
        }
    }

    @ViewBuilder
    private func libraryPreviewDisplayView(selection: LibraryListSelection, stations: [Station]) -> some View {
        switch libraryDisplayMode(for: selection) {
        case .list:
            libraryPreviewList(selection: selection, stations: stations)
        case .tiles:
            libraryPreviewTileGrid(selection: selection, stations: stations)
        case .app:
            libraryPreviewAppGrid(selection: selection, stations: stations)
        }
    }

    private func libraryPreviewList(selection: LibraryListSelection, stations: [Station]) -> some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: stationHeaderStackSpacing) {
                libraryPreviewInlineControls(for: selection)

                Section {
                    ForEach(Array(stations.enumerated()), id: \.element.id) { index, station in
                        libraryPreviewStationRow(station, selection: selection)
                            .padding(.top, index == 0 ? stationHeaderStackSpacing : 0)
                    }
                } header: {
                    stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                }
            }
            .padding(.top, stationHeaderTopPadding)
            .padding(.bottom, 12)
        }
        .scrollDisabled(true)
        .background(RrradioTheme.bg)
    }

    private func libraryPreviewTileGrid(selection: LibraryListSelection, stations: [Station]) -> some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: stationHeaderStackSpacing) {
                libraryPreviewInlineControls(for: selection)

                Section {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: favoriteTileGridColumnCount),
                        spacing: 10,
                    ) {
                        ForEach(stations) { station in
                            FavoriteStationTile(
                                station: station,
                                nowPlaying: favoriteNowPlayingMetadata(for: station),
                                isCurrent: player.current?.id == station.id,
                                isPlaying: player.current?.id == station.id && player.state == .playing,
                                isCustom: library.isCustom(station),
                            )
                        }
                    }
                    .padding(.top, stationHeaderStackSpacing)
                    .padding(.horizontal, 14)
                } header: {
                    stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                }
            }
            .padding(.top, stationHeaderTopPadding)
            .padding(.bottom, 16)
        }
        .scrollDisabled(true)
        .background(RrradioTheme.bg)
    }

    private func libraryPreviewAppGrid(selection: LibraryListSelection, stations: [Station]) -> some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: stationHeaderStackSpacing) {
                libraryPreviewInlineControls(for: selection)

                Section {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: favoriteAppGridColumnCount),
                        alignment: .center,
                        spacing: 18,
                    ) {
                        ForEach(stations) { station in
                            FavoriteStationAppIcon(
                                station: station,
                                isCurrent: player.current?.id == station.id,
                                isCustom: library.isCustom(station),
                                dragProvider: nil,
                            )
                        }
                    }
                    .padding(.top, stationHeaderStackSpacing)
                    .padding(.horizontal, 18)
                } header: {
                    stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                }
            }
            .padding(.top, stationHeaderTopPadding)
            .padding(.bottom, 18)
        }
        .scrollDisabled(true)
        .background(RrradioTheme.bg)
    }

    @ViewBuilder
    private func libraryPreviewStationRow(_ station: Station, selection _: LibraryListSelection) -> some View {
        libraryCardRow(station, allowsPlayback: false, allowsDeleteControls: false)
    }

    @ViewBuilder
    private func libraryDisplayView(for mode: FavoritesDisplayMode) -> some View {
        Group {
            switch mode {
            case .list:
                libraryCardList
            case .tiles:
                favoritesTileGrid
            case .app:
                favoritesAppGrid
            }
        }
        // Drag-cancel watchdog. SwiftUI's `.onDrag` API has no drop-end
        // callback when the user lifts their finger outside any drop
        // target — `draggedFavoriteStationID` then stays set, the
        // source tile remains hidden, and its tap target keeps firing.
        // `.task(id:)` restarts whenever the dragged id changes;
        // sleeping for 6s and then clearing if nothing else has reset
        // it recovers from any drag-cancel path. 6s is comfortably
        // longer than any realistic reorder (<1s) and short enough
        // that the user notices the recovery within a beat.
        // Proper fix is the Transferable migration tracked in #374.
        .task(id: draggedFavoriteStationID) {
            guard draggedFavoriteStationID != nil else { return }
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard !Task.isCancelled, draggedFavoriteStationID != nil else { return }
            clearFavoriteGridDragState()
        }
    }

    private var stationScrollList: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ScrollOffsetObserver(offset: $listScrollOffset, maximumOffset: stickyHeaderPinnedOffset)
                    .frame(width: 0, height: 0)

                LazyVStack(spacing: stationHeaderStackSpacing, pinnedViews: stationScrollPinnedViews) {
                    if pageTab == .browse {
                        inlineBrowseControls
                    } else if isLibraryPage {
                        inlineStationListsControls()
                    }

                    Section {
                        if isStationListsDetail && filteredStations.isEmpty {
                            stationListEmptyState
                                .padding(.top, stationHeaderStackSpacing)
                        } else if showingFavoritesCatalogFallback {
                            favoritesCatalogFallbackNotice
                                .padding(.top, stationHeaderStackSpacing)
                        }

                        ForEach(Array(visibleStations.enumerated()), id: \.element.id) { index, station in
                            stationScrollRow(station)
                                .padding(.top, !showingFavoritesCatalogFallback && index == 0 ? stationHeaderStackSpacing : 0)
                        }
                        if visibleStations.count < filteredStations.count || canLoadWorldwideStations {
                            loadMoreRow
                        }
                    } header: {
                        stationScrollSectionHeader
                    }
                }
                .padding(.top, stationHeaderTopPadding)
                .padding(.bottom, 12)
                .background {
                    stationListDeleteModeDismissBackground
                }
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .scrollDisabled(isHorizontalSwipeLocked)
        .background(RrradioTheme.bg)
    }

    @ViewBuilder
    private func stationScrollRow(_ station: Station) -> some View {
        if isBrowseListSelectionMode {
            HStack(spacing: 0) {
                browseStationSelectionButton(station)
                    .frame(width: 42)
                standardStationRow(station, selectingForList: true)
                    .frame(maxWidth: .infinity)
            }
            .padding(.leading, 2)
            .transition(.opacity.combined(with: .move(edge: .leading)))
        } else if isStationListStationDeleteMode {
            stationListStationDeleteRow(station)
        } else {
            standardStationRow(station, selectingForList: false)
        }
    }

    private func standardStationRow(_ station: Station, selectingForList: Bool) -> some View {
        StationRow(
            station: station,
            nowPlaying: usesFavoritesRows ? favoriteNowPlayingMetadata(for: station) : nil,
            mode: usesFavoritesRows ? .favoritesExpanded : .standard,
            isCurrent: player.current?.id == station.id,
            isPlaying: player.current?.id == station.id && player.state == .playing,
            isFavorite: library.isFavorite(station),
            isCustom: library.isCustom(station),
            onPlay: {
                performSwipeSafeActivation {
                    if selectingForList {
                        toggleBrowseStationSelection(station)
                    } else if isStationListStationDeleteMode {
                        hideStationListDeleteMode()
                    } else {
                        play(station)
                    }
                }
            },
            onToggleFavorite: {
                performSwipeSafeActivation {
                    library.toggleFavorite(station)
                }
            },
            showsFavoriteButton: !usesFavoritesRows && !isStationListStationDeleteMode,
            showsStreamQualityButton: !isStationListStationDeleteMode,
            onInfoHoldChanged: !selectingForList && !isStationListStationDeleteMode && source == .all ? { isHolding in
                handleStationInfoHoldChanged(isHolding, station: station)
            } : nil,
            shouldSuppressActivation: consumeSwipeSuppressedActivation,
        )
    }

    private func stationListStationDeleteRow(_ station: Station) -> some View {
        ZStack(alignment: .trailing) {
            HStack(spacing: 0) {
                standardStationRow(station, selectingForList: false)
                    .frame(maxWidth: .infinity)

                Color.clear
                    .frame(width: favoriteRemoveControlSlotWidth)
                    .accessibilityHidden(true)
            }

            stationListStationDeleteButton(station)
                .padding(.trailing, favoriteRemoveControlTrailingInset)
                .transition(.scale(scale: 0.82).combined(with: .opacity))
        }
        .animation(.snappy(duration: 0.16), value: stationListDeleteModeEnabled)
        .contentShape(Rectangle())
        .onTapGesture {
            performSwipeSafeActivation {
                hideStationListDeleteMode()
            }
        }
        .accessibilityHint("Tap outside remove buttons to exit remove mode")
    }

    private func browseStationSelectionButton(_ station: Station) -> some View {
        let selected = browseListSelectedStationIDs.contains(station.id)
        return Button {
            performSwipeSafeActivation {
                toggleBrowseStationSelection(station)
            }
        } label: {
            Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 20, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? RrradioTheme.accent : RrradioTheme.ink3)
                .frame(width: 42, height: 42)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(locale.text(.selectStation))
    }

    private var libraryOverview: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ScrollOffsetObserver(offset: $listScrollOffset, maximumOffset: stickyHeaderPinnedOffset)
                    .frame(width: 0, height: 0)

                LazyVStack(spacing: stationHeaderStackSpacing) {
                    inlineStationListsControls()

                    Section {
                        if filteredLibrarySelections.isEmpty {
                            stationListEmptyState
                                .padding(.top, stationHeaderStackSpacing)
                        } else {
                            ForEach(filteredLibrarySelections) { selection in
                                libraryOverviewCard(selection)
                                    .padding(.horizontal, 14)
                                    .padding(.top, selection == filteredLibrarySelections.first ? stationHeaderStackSpacing : 0)
                            }
                        }
                    } header: {
                        stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                    }
                }
                .padding(.top, stationHeaderTopPadding)
                .padding(.bottom, 12)
                .background {
                    stationListDeleteModeDismissBackground
                }
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .scrollDisabled(isHorizontalSwipeLocked)
        .background(RrradioTheme.bg)
    }

    @ViewBuilder
    private func libraryOverviewCard(_ selection: LibraryListSelection) -> some View {
        switch selection {
        case .stationList(let id):
            if let list = library.stationList(id: id) {
                StationListCard(
                    stationList: list,
                    emptyLabel: locale.text(.emptyStationList),
                    isCurrent: stationListIsCurrentPlaybackSource(list),
                    isFirstStationCustom: list.stations.first.map(library.isCustom) ?? false,
                    isDeleteModeEnabled: stationListDeleteModeEnabled && canDeleteStationListsOverview,
                ) {
                    performSwipeSafeActivation {
                        if stationListDeleteModeEnabled {
                            hideStationListDeleteMode()
                        } else {
                            openStationList(list)
                        }
                    }
                } onPlay: {
                    performSwipeSafeActivation {
                        if stationListDeleteModeEnabled {
                            hideStationListDeleteMode()
                        } else {
                            playStationList(list)
                        }
                    }
                } onDelete: {
                    removeStationListFromOverview(list)
                }
            }
        case .home, .recents, .favorites:
            LibrarySelectionCard(
                title: librarySelectionTitle(selection),
                icon: librarySelectionIcon(selection),
                count: librarySelectionCount(selection),
                summary: librarySelectionSummary(selection),
                isCurrent: librarySelectionIsCurrentPlaybackSource(selection),
            ) {
                performSwipeSafeActivation {
                    if stationListDeleteModeEnabled {
                        hideStationListDeleteMode()
                    } else {
                        setLibrarySelection(selection)
                    }
                }
            }
        }
    }

    private var stationListEmptyState: some View {
        ContentUnavailableView(
            stationListEmptyTitle,
            systemImage: stationListEmptyIcon,
            description: Text(stationListEmptyDescription),
        )
        .foregroundStyle(RrradioTheme.ink)
        .padding(.horizontal, 24)
        .padding(.vertical, 42)
        .frame(maxWidth: .infinity)
    }

    private var stationListEmptyTitle: String {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return locale.text(.noStationsFound)
        }
        return isStationListsDetail ? locale.text(.emptyStationList) : locale.text(.noStationLists)
    }

    private var stationListEmptyIcon: String {
        isStationListsDetail ? "antenna.radiowaves.left.and.right.slash" : "list.bullet.rectangle"
    }

    private var stationListEmptyDescription: String {
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return locale.text(.trySearch)
        }
        return isStationListsDetail ? locale.text(.emptyStationListHint) : locale.text(.stationListsHint)
    }

    private var browseListSelectionBar: some View {
        HStack(spacing: 10) {
            Button {
                cancelBrowseListSelection()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 34, height: 34)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(locale.text(.cancel))

            HStack(spacing: 8) {
                TextField(locale.text(.stationListName), text: $browseListNameDraft)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .tint(RrradioTheme.accent)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)

                if !browseListSelectedStationIDs.isEmpty {
                    Text(browseListSelectionCountLabel)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .foregroundStyle(RrradioTheme.bg)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Circle().fill(RrradioTheme.accent))
                }
            }
            .padding(.leading, 13)
            .padding(.trailing, 10)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(RrradioTheme.bg2)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(RrradioTheme.line))

            Button {
                showingBrowseListPicker = true
            } label: {
                Image(systemName: "list.bullet.rectangle")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(library.stationLists.isEmpty ? RrradioTheme.ink4 : RrradioTheme.ink3)
                    .frame(width: 34, height: 34)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(library.stationLists.isEmpty)
            .accessibilityLabel(locale.text(.chooseStationList))

            Button {
                saveBrowseListSelection()
            } label: {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(canSaveBrowseListSelection ? RrradioTheme.bg : RrradioTheme.ink4)
                    .frame(width: 34, height: 34)
                    .background(canSaveBrowseListSelection ? RrradioTheme.accent : RrradioTheme.bg2)
                    .clipShape(Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSaveBrowseListSelection)
            .accessibilityLabel(locale.text(.save))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(RrradioTheme.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    @ViewBuilder
    private var stationScrollSectionHeader: some View {
        stickySectionHeader(
            includesRule: pageTab == .browse || isLibraryPage,
            pinnedTopPadding: isLibraryPage ? libraryHeaderRuleTopPadding : nil,
        )
    }

    @ViewBuilder
    private func stickySectionHeader(includesRule: Bool, pinnedTopPadding: CGFloat? = nil) -> some View {
        if includesRule || hasTimerStatus {
            VStack(spacing: 0) {
                if includesRule {
                    headerRule
                }
                timerStatusStrip
            }
            .frame(maxWidth: .infinity)
            .padding(.top, pinnedTopPadding ?? stickyHeaderPinnedTopPadding)
            .background(RrradioTheme.bg)
        }
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

    private var libraryCardList: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ScrollOffsetObserver(offset: $listScrollOffset)
                    .frame(width: 0, height: 0)

                LazyVStack(spacing: stationHeaderStackSpacing) {
                    inlineFavoritesControls()

                    Section {
                        ForEach(Array(visibleStations.enumerated()), id: \.element.id) { index, station in
                            libraryCardListRow(station)
                                .padding(.top, index == 0 ? stationHeaderStackSpacing : 0)
                        }

                        if visibleStations.count < filteredStations.count {
                            loadMoreRow
                        }
                    } header: {
                        stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                    }
                }
                .padding(.top, stationHeaderTopPadding)
                .padding(.bottom, 12)
                .background {
                    libraryDeleteModeDismissBackground
                }
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .scrollDisabled(isHorizontalSwipeLocked)
        .background(RrradioTheme.bg)
        .onDisappear(perform: clearFavoriteGridDragState)
    }

    @ViewBuilder
    private func libraryCardListRow(_ station: Station) -> some View {
        if canReorderFavorites {
            libraryCardRow(station)
                .onDrag {
                    favoriteGridDragProvider(for: station)
                }
                .onDrop(
                    of: [UTType.plainText],
                    delegate: FavoriteStationDropDelegate(
                        targetStationID: station.id,
                        targetSize: nil,
                        dropBehavior: .targetSlot,
                        draggedStationID: $draggedFavoriteStationID,
                        targetedStationID: $targetedFavoriteStationID,
                        lastMoveAt: $lastFavoriteDropMoveAt,
                        moveStation: moveFavoriteGridStation,
                    ),
                )
                .accessibilityHint(favoriteDeleteModeEnabled ? "Tap outside remove buttons to exit remove mode" : "Drag to reorder favorites")
        } else {
            libraryCardRow(station)
        }
    }

    private func libraryCardRow(
        _ station: Station,
        allowsPlayback: Bool = true,
        allowsDeleteControls: Bool = true,
    ) -> some View {
        let showsFavoriteRemove = allowsDeleteControls && isFavoritesPage && favoriteDeleteModeEnabled
        let showsStationListRemove = allowsDeleteControls && isStationListStationDeleteMode
        let showsRemoveControl = showsFavoriteRemove || showsStationListRemove

        return ZStack(alignment: .trailing) {
            HStack(spacing: 0) {
                StationRow(
                    station: station,
                    nowPlaying: favoriteNowPlayingMetadata(for: station),
                    mode: .favoritesListCard,
                    isCurrent: player.current?.id == station.id,
                    isPlaying: player.current?.id == station.id && player.state == .playing,
                    isFavorite: library.isFavorite(station),
                    isCustom: library.isCustom(station),
                    onPlay: {
                        guard allowsPlayback else { return }
                        performSwipeSafeActivation {
                            if showsFavoriteRemove {
                                hideFavoriteDeleteMode()
                            } else if showsStationListRemove {
                                hideStationListDeleteMode()
                            } else {
                                play(station)
                            }
                        }
                    },
                    onToggleFavorite: {},
                    showsFavoriteButton: false,
                    shouldSuppressActivation: consumeSwipeSuppressedActivation,
                )
                .frame(maxWidth: .infinity)

                if showsRemoveControl {
                    Color.clear
                        .frame(width: favoriteRemoveControlSlotWidth)
                        .accessibilityHidden(true)
                }
            }

            if showsFavoriteRemove {
                favoriteDeleteButton(station)
                    .padding(.trailing, favoriteRemoveControlTrailingInset)
                    .transition(.scale(scale: 0.82).combined(with: .opacity))
            } else if showsStationListRemove {
                stationListStationDeleteButton(station)
                    .padding(.trailing, favoriteRemoveControlTrailingInset)
                    .transition(.scale(scale: 0.82).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.16), value: favoriteDeleteModeEnabled)
        .animation(.snappy(duration: 0.16), value: stationListDeleteModeEnabled)
        .contentShape(Rectangle())
        .onTapGesture {
            guard showsRemoveControl else { return }
            performSwipeSafeActivation {
                if showsFavoriteRemove {
                    hideFavoriteDeleteMode()
                } else if showsStationListRemove {
                    hideStationListDeleteMode()
                }
            }
        }
        .accessibilityHint(showsRemoveControl ? "Tap outside remove buttons to exit remove mode" : "")
    }

    private var favoritesTileGrid: some View {
        GeometryReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ScrollOffsetObserver(offset: $listScrollOffset)
                        .frame(width: 0, height: 0)

                    LazyVStack(spacing: stationHeaderStackSpacing) {
                        inlineFavoritesControls()

                        Section {
                            LazyVGrid(
                                columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: favoriteTileGridColumnCount),
                                spacing: 10,
                            ) {
                                ForEach(visibleStations) { station in
                                    favoriteGridItem(
                                        station: station,
                                        dropBehavior: .targetSlot,
                                    ) {
                                        FavoriteStationTile(
                                            station: station,
                                            nowPlaying: favoriteNowPlayingMetadata(for: station),
                                            isCurrent: player.current?.id == station.id,
                                            isPlaying: player.current?.id == station.id && player.state == .playing,
                                            isCustom: library.isCustom(station),
                                        )
                                    }
                                }
                            }
                            .onDrop(
                                of: [UTType.plainText],
                                delegate: FavoriteGridDropResetDelegate(
                                    draggedStationID: $draggedFavoriteStationID,
                                    targetedStationID: $targetedFavoriteStationID,
                                    lastMoveAt: $lastFavoriteDropMoveAt,
                                ),
                            )
                            .padding(.top, stationHeaderStackSpacing)
                            .padding(.horizontal, 14)

                            if visibleStations.count < filteredStations.count {
                                loadMoreRow
                                    .padding(.horizontal, 14)
                            }
                        } header: {
                            stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                        }
                    }
                    .padding(.top, stationHeaderTopPadding)
                    .padding(.bottom, 16)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
                .onDrop(
                    of: [UTType.plainText],
                    delegate: FavoriteGridDropResetDelegate(
                        draggedStationID: $draggedFavoriteStationID,
                        targetedStationID: $targetedFavoriteStationID,
                        lastMoveAt: $lastFavoriteDropMoveAt,
                    ),
                )
                .background {
                    libraryDeleteModeDismissBackground
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .scrollDisabled(isHorizontalSwipeLocked)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(RrradioTheme.bg)
        .onDisappear(perform: clearFavoriteGridDragState)
    }

    private var favoritesAppGrid: some View {
        GeometryReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    ScrollOffsetObserver(offset: $listScrollOffset)
                        .frame(width: 0, height: 0)

                    LazyVStack(spacing: stationHeaderStackSpacing) {
                        inlineFavoritesControls()

                        Section {
                            LazyVGrid(
                                columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: favoriteAppGridColumnCount),
                                alignment: .center,
                                spacing: 18,
                            ) {
                                ForEach(visibleStations) { station in
                                    favoriteGridItem(
                                        station: station,
                                        dragSource: .content,
                                    ) {
                                        FavoriteStationAppIcon(
                                            station: station,
                                            isCurrent: player.current?.id == station.id,
                                            isCustom: library.isCustom(station),
                                            dragProvider: canReorderFavorites ? { favoriteGridDragProvider(for: station) } : nil,
                                        )
                                    }
                                }
                            }
                            .onDrop(
                                of: [UTType.plainText],
                                delegate: FavoriteGridDropResetDelegate(
                                    draggedStationID: $draggedFavoriteStationID,
                                    targetedStationID: $targetedFavoriteStationID,
                                    lastMoveAt: $lastFavoriteDropMoveAt,
                                ),
                            )
                            .padding(.top, stationHeaderStackSpacing)
                            .padding(.horizontal, 18)

                            if visibleStations.count < filteredStations.count {
                                loadMoreRow
                                    .padding(.horizontal, 18)
                            }
                        } header: {
                            stickySectionHeader(includesRule: true, pinnedTopPadding: libraryHeaderRuleTopPadding)
                        }
                    }
                    .padding(.top, stationHeaderTopPadding)
                    .padding(.bottom, 18)
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .top)
                .onDrop(
                    of: [UTType.plainText],
                    delegate: FavoriteGridDropResetDelegate(
                        draggedStationID: $draggedFavoriteStationID,
                        targetedStationID: $targetedFavoriteStationID,
                        lastMoveAt: $lastFavoriteDropMoveAt,
                    ),
                )
                .background {
                    libraryDeleteModeDismissBackground
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .scrollDisabled(isHorizontalSwipeLocked)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(RrradioTheme.bg)
        .onDisappear(perform: clearFavoriteGridDragState)
    }

    @ViewBuilder
    private var libraryDeleteModeDismissBackground: some View {
        if favoriteDeleteModeEnabled || stationListDeleteModeEnabled {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture {
                    hideFavoriteDeleteMode()
                    hideStationListDeleteMode()
                }
        }
    }

    @ViewBuilder
    private func favoriteGridItem<Content: View>(
        station: Station,
        dragSource: FavoriteGridDragSource = .item,
        dropBehavior: FavoriteGridDropBehavior = .horizontalSplit,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        if isStationListStationDeleteMode {
            ZStack(alignment: .topTrailing) {
                content()

                stationListGridDeleteBadge(station)
                    .offset(x: 10, y: -10)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                performSwipeSafeActivation {
                    hideStationListDeleteMode()
                }
            }
            .accessibilityAddTraits(.isButton)
            .accessibilityHint("Tap outside remove buttons to exit remove mode")
        } else if canReorderFavorites {
            // Only hide the source AFTER the first reorder move has
            // registered — `lastFavoriteDropMoveAt != nil` confirms
            // some drop machinery actually fired. The earlier
            // formulation hid on `draggedFavoriteStationID == station.id`
            // alone for smoother initial pickup, but SwiftUI's
            // `.onDrag` has no drag-cancel callback: if the user lifts
            // their finger outside any drop target, `draggedStationID`
            // stays set, the tile stays at opacity 0, and its tap
            // target keeps firing playback. The proper fix
            // (Transferable + .draggable / .dropDestination) is
            // tracked in #374. The watchdog on favoritesDisplayView
            // backstops any case this gate misses.
            let showsReorderPlaceholder = draggedFavoriteStationID == station.id
                && lastFavoriteDropMoveAt != nil
            let showsDeleteButton = favoriteDeleteModeEnabled
            // SpringBoard-style jiggle while the user is in delete mode.
            // Per-station seed gives each tile a slightly different
            // oscillation period so adjacent tiles don't beat in unison.
            let isJiggling = favoriteDeleteModeEnabled
            let item = ZStack(alignment: .topTrailing) {
                content()

                if showsDeleteButton {
                    favoriteGridDeleteBadge(station)
                        // Offset so the badge straddles the icon's
                        // top-trailing corner instead of sitting
                        // inside the bounds. Matches iPhone Home,
                        // which places the X badge half-overlapping
                        // the icon. The badge has its own padding so
                        // a positive x / negative y is enough.
                        .offset(x: 10, y: -10)
                }
            }
                .modifier(FavoriteJiggleModifier(isActive: isJiggling, seed: station.id.hashValue))
                .opacity(showsReorderPlaceholder ? 0 : 1)
                .contentShape(Rectangle())
                .onTapGesture {
                    performSwipeSafeActivation {
                        if favoriteDeleteModeEnabled {
                            hideFavoriteDeleteMode()
                        } else {
                            handleFavoriteGridTap(station)
                        }
                    }
                }
                .accessibilityAddTraits(.isButton)

            switch dragSource {
            case .item:
                item
                    .onDrag {
                        favoriteGridDragProvider(for: station)
                    }
                    .onDrop(
                        of: [UTType.plainText],
                        delegate: FavoriteStationDropDelegate(
                            targetStationID: station.id,
                            targetSize: nil,
                            dropBehavior: dropBehavior,
                            draggedStationID: $draggedFavoriteStationID,
                            targetedStationID: $targetedFavoriteStationID,
                            lastMoveAt: $lastFavoriteDropMoveAt,
                            moveStation: moveFavoriteGridStation,
                        ),
                    )
                    .accessibilityHidden(showsReorderPlaceholder)
                    .accessibilityHint(favoriteDeleteModeEnabled ? "Tap outside remove buttons to exit remove mode" : "Drag to reorder favorites")
            case .content:
                item
                    .onDrop(
                        of: [UTType.plainText],
                        delegate: FavoriteStationDropDelegate(
                            targetStationID: station.id,
                            targetSize: nil,
                            dropBehavior: dropBehavior,
                            draggedStationID: $draggedFavoriteStationID,
                            targetedStationID: $targetedFavoriteStationID,
                            lastMoveAt: $lastFavoriteDropMoveAt,
                            moveStation: moveFavoriteGridStation,
                        ),
                    )
                    .accessibilityHidden(showsReorderPlaceholder)
                    .accessibilityHint(favoriteDeleteModeEnabled ? "Tap outside remove buttons to exit remove mode" : "Drag to reorder favorites")
            }
        } else {
            content()
                .contentShape(Rectangle())
                .onTapGesture {
                    performSwipeSafeActivation {
                        handleFavoriteGridTap(station)
                    }
                }
                .accessibilityAddTraits(.isButton)
        }
    }

    private func favoriteGridDragProvider(for station: Station) -> NSItemProvider {
        draggedFavoriteStationID = station.id
        targetedFavoriteStationID = nil
        lastFavoriteDropMoveAt = nil
        // Long-press → drag pickup → enter delete mode. Mirrors iPhone
        // Home: holding a tile lifts it AND switches the whole grid
        // into edit mode (jiggle starts, minus badges appear).
        // Releasing without moving cancels the drag but the grid stays
        // in delete mode so the user can either tap a minus badge or
        // drag another tile.
        if !favoriteDeleteModeEnabled {
            withAnimation(.snappy(duration: 0.16)) {
                favoriteDeleteModeEnabled = true
            }
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        return NSItemProvider(object: station.id as NSString)
    }

    private enum FavoriteGridDragSource {
        case item
        case content
    }

    private func clearFavoriteGridDragState() {
        guard draggedFavoriteStationID != nil
            || targetedFavoriteStationID != nil
            || lastFavoriteDropMoveAt != nil
            || favoriteDeleteModeEnabled else { return }
        draggedFavoriteStationID = nil
        targetedFavoriteStationID = nil
        lastFavoriteDropMoveAt = nil
        favoriteDeleteModeEnabled = false
    }

    private func toggleFavoriteDeleteMode() {
        guard canReorderFavorites else { return }
        activeFilterPicker = nil
        withAnimation(.snappy(duration: 0.16)) {
            favoriteDeleteModeEnabled.toggle()
        }
        if favoriteDeleteModeEnabled {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private func hideFavoriteDeleteMode(animated: Bool = true) {
        guard favoriteDeleteModeEnabled else { return }
        if animated {
            withAnimation(.snappy(duration: 0.12)) {
                favoriteDeleteModeEnabled = false
            }
        } else {
            favoriteDeleteModeEnabled = false
        }
    }

    private func toggleStationListDeleteMode() {
        guard canUseStationListDeleteMode else { return }
        activeFilterPicker = nil
        withAnimation(.snappy(duration: 0.16)) {
            stationListDeleteModeEnabled.toggle()
        }
        if stationListDeleteModeEnabled {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private func hideStationListDeleteMode(animated: Bool = true) {
        guard stationListDeleteModeEnabled else { return }
        if animated {
            withAnimation(.snappy(duration: 0.12)) {
                stationListDeleteModeEnabled = false
            }
        } else {
            stationListDeleteModeEnabled = false
        }
    }

    private func favoriteDeleteButton(_ station: Station) -> some View {
        Button {
            removeFavoriteFromGrid(station)
        } label: {
            Image(systemName: "minus.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove from favorites")
        .transition(.scale(scale: 0.82).combined(with: .opacity))
    }

    /// iPhone-Home-style minus badge for the tile + app grids. White
    /// circle, black minus, thin shadow for contrast against bright
    /// favicons. Sized at ~24pt and positioned to overlap the icon's
    /// top-trailing corner — same affordance as iOS edit mode, instead
    /// of the tiny in-bounds button the previous grid code used.
    private func favoriteGridDeleteBadge(_ station: Station) -> some View {
        Button {
            removeFavoriteFromGrid(station)
        } label: {
            Image(systemName: "minus.circle.fill")
                .symbolRenderingMode(.palette)
                // First color: the minus stroke. Second: the circle
                // fill. Black-on-white reads against any favicon
                // colour, including the white circles a few stations
                // ship as their logo background.
                .foregroundStyle(.black, .white)
                .font(.system(size: 24, weight: .regular))
                .shadow(color: .black.opacity(0.30), radius: 1.5, x: 0, y: 1)
                // Hit area generous enough that it's still tappable
                // when the icon is mid-jiggle (the badge wobbles with
                // its parent ZStack).
                .frame(width: 32, height: 32)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove from favorites")
        .transition(.scale(scale: 0.82).combined(with: .opacity))
    }

    private func stationListGridDeleteBadge(_ station: Station) -> some View {
        Button {
            removeStationFromSelectedList(station)
        } label: {
            Image(systemName: "minus.circle.fill")
                .symbolRenderingMode(.palette)
                .foregroundStyle(.black, .white)
                .font(.system(size: 24, weight: .regular))
                .shadow(color: .black.opacity(0.30), radius: 1.5, x: 0, y: 1)
                .frame(width: 32, height: 32)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(station.name) from list")
        .transition(.scale(scale: 0.82).combined(with: .opacity))
    }

    private func stationListStationDeleteButton(_ station: Station) -> some View {
        Button {
            removeStationFromSelectedList(station)
        } label: {
            Image(systemName: "minus.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: topbarControlSize, height: topbarControlSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(station.name) from list")
        .transition(.scale(scale: 0.82).combined(with: .opacity))
    }

    private func removeFavoriteFromGrid(_ station: Station) {
        filterTask?.cancel()
        withAnimation(.snappy(duration: 0.18)) {
            filteredStations.removeAll { $0.id == station.id }
        }
        if library.isFavorite(station) {
            library.toggleFavorite(station)
        }
    }

    private func removeStationListFromOverview(_ list: StationList) {
        guard library.removeStationList(id: list.id) else { return }
        if browseListTargetStationListID == list.id {
            browseListTargetStationListID = nil
        }
        if selectedStationListID == list.id {
            closeStationListDetail()
        }
        if library.stationLists.isEmpty {
            hideStationListDeleteMode(animated: false)
        }
    }

    private func removeStationFromSelectedList(_ station: Station) {
        guard let selectedStationListID,
              library.removeStation(station, fromStationList: selectedStationListID) else { return }
        filterTask?.cancel()
        withAnimation(.snappy(duration: 0.18)) {
            filteredStations.removeAll { $0.id == station.id }
        }
        if selectedStationList?.stations.isEmpty ?? true {
            hideStationListDeleteMode(animated: false)
        }
    }

    private func handleFavoriteGridTap(_ station: Station) {
        play(station)
    }

    private func toggleBrowseListSelectionMode() {
        guard canUseBrowseListSelection else { return }
        if isBrowseListSelectionMode {
            cancelBrowseListSelection()
        } else {
            dismissSearch()
            activeFilterPicker = nil
            closeStationInfoPreview()
            browseListSelectionActive = true
            browseStationListSelectionActiveExternally = true
        }
    }

    private func toggleBrowseStationSelection(_ station: Station) {
        guard isBrowseListSelectionMode else { return }
        if browseListSelectedStationIDs.contains(station.id) {
            browseListSelectedStationIDs.remove(station.id)
            browseListSelectedStationOrder.removeAll { $0 == station.id }
        } else {
            browseListSelectedStationIDs.insert(station.id)
            browseListSelectedStationOrder.append(station.id)
        }
    }

    private func selectBrowseListTarget(_ list: StationList) {
        browseListTargetStationListID = list.id
        browseListNameDraft = list.name
    }

    private func clearBrowseListTargetIfNameChanged(_ value: String) {
        guard let target = browseListTargetStationList else { return }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed != target.name {
            browseListTargetStationListID = nil
        }
    }

    private func saveBrowseListSelection() {
        let name = browseListNameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let selectedStations = selectedBrowseStationsForSave
        guard !selectedStations.isEmpty else { return }

        if let targetID = browseListTargetStationListID,
           library.stationList(id: targetID) != nil {
            for station in selectedStations {
                library.addStation(station, toStationList: targetID)
            }
        } else if let existing = library.stationLists.first(where: { $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame }) {
            for station in selectedStations {
                library.addStation(station, toStationList: existing.id)
            }
        } else {
            library.createStationList(name: name, stations: selectedStations)
        }

        cancelBrowseListSelection()
    }

    private func cancelBrowseListSelection() {
        guard browseListSelectionActive
            || !browseListSelectedStationIDs.isEmpty
            || !browseListSelectedStationOrder.isEmpty
            || !browseListNameDraft.isEmpty
            || browseListTargetStationListID != nil
            || showingBrowseListPicker else { return }
        browseListSelectionActive = false
        browseStationListSelectionActiveExternally = false
        browseListSelectedStationIDs = []
        browseListSelectedStationOrder = []
        browseListNameDraft = ""
        browseListTargetStationListID = nil
        showingBrowseListPicker = false
    }

    private func openCreateStationListDialog() {
        hideStationListDeleteMode(animated: false)
        clearSearchState()
        stationListNameDraft = ""
        showingCreateStationList = true
    }

    private func createStationListFromDraft() {
        let list = library.createStationList(name: stationListNameDraft)
        stationListNameDraft = ""
        openStationList(list)
    }

    private func openStationList(_ list: StationList) {
        hideStationListDeleteMode(animated: false)
        clearSearchState()
        selectedStationListID = list.id
        librarySelectionRaw = LibraryListSelection.stationList(list.id).rawValue
        resetStationDisplayLimit()
        listScrollOffset = 0
        recomputeFilteredStations()
    }

    private func closeStationListDetail() {
        hideStationListDeleteMode(animated: false)
        clearSearchState()
        selectedStationListID = nil
        librarySelectionRaw = LibraryListSelection.home.rawValue
        resetStationDisplayLimit()
        listScrollOffset = 0
        recomputeFilteredStations()
    }

    private func resetStationListPage() {
        guard isLibraryPage else { return }
        listScrollOffset = 0
        recomputeFilteredStations()
    }

    private func stationListIsCurrentPlaybackSource(_ list: StationList) -> Bool {
        player.activePlaybackQueueSource == .stationList
            && player.activePlaybackQueueSourceID == list.id
    }

    private func librarySelectionCount(_ selection: LibraryListSelection) -> Int {
        switch selection {
        case .home:
            return librarySelections.count - 1
        case .recents:
            return library.recents.count
        case .favorites:
            return library.favorites.count
        case .stationList(let id):
            return library.stationList(id: id)?.stations.count ?? 0
        }
    }

    private func librarySelectionSummary(_ selection: LibraryListSelection) -> String {
        switch selection {
        case .home:
            return "Recents, favorites, and station lists"
        case .recents:
            return library.recents.prefix(3).map(\.name).joined(separator: " . ").nilIfEmpty ?? locale.text(.recentsHint)
        case .favorites:
            return library.favorites.prefix(3).map(\.name).joined(separator: " . ").nilIfEmpty ?? locale.text(.tapHeart)
        case .stationList(let id):
            return library.stationList(id: id)?.stations.prefix(3).map(\.name).joined(separator: " . ").nilIfEmpty
                ?? locale.text(.emptyStationList)
        }
    }

    private func librarySelectionIsCurrentPlaybackSource(_ selection: LibraryListSelection) -> Bool {
        switch selection {
        case .home:
            return false
        case .recents:
            return player.activePlaybackQueueSource == .recents
        case .favorites:
            return player.activePlaybackQueueSource == .favorites
        case .stationList(let id):
            return player.activePlaybackQueueSource == .stationList
                && player.activePlaybackQueueSourceID == id
        }
    }

    private func play(_ station: Station) {
        dismissSearch()
        player.play(station, queue: playbackQueue(for: station))
        if let metadata = favoriteNowPlaying.entries[station.id]?.metadata {
            player.applyPrefetchedMetadata(metadata, for: station)
        }
        if !library.isCustom(station) {
            library.pushRecent(station)
        }
        showingNowPlaying = true
    }

    private func playStationList(_ list: StationList) {
        guard let firstStation = list.stations.first else { return }
        dismissSearch()
        let queue = StationPlaybackQueue(
            source: .stationList,
            sourceID: list.id,
            stations: list.stations,
            current: firstStation,
        )
        player.play(firstStation, queue: queue)
        if !library.isCustom(firstStation) {
            library.pushRecent(firstStation)
        }
        showingNowPlaying = true
    }

    private func playbackQueue(for station: Station) -> StationPlaybackQueue {
        StationPlaybackQueue(
            source: playbackQueueSource,
            sourceID: playbackQueueSourceID,
            stations: visibleStations,
            current: station,
        )
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

    private func favoriteNowPlayingMetadata(for station: Station) -> NowPlayingMetadata? {
        let cached = favoriteNowPlaying.entries[station.id]?.metadata
        guard player.current?.id == station.id else { return cached }

        let liveArtist = cleanInfoValue(player.nowPlayingArtist)
        let liveTitle = cleanInfoValue(player.nowPlayingTitle)
        let liveProgramName = cleanInfoValue(player.nowPlayingProgramName)
        let liveProgramSubtitle = cleanInfoValue(player.nowPlayingProgramSubtitle)
        let coverUrl = player.nowPlayingCoverUrl ?? cached?.coverUrl

        guard liveArtist != nil
                || liveTitle != nil
                || liveProgramName != nil
                || liveProgramSubtitle != nil
                || coverUrl != nil else {
            return cached
        }

        let title = liveTitle ?? cached?.title
        let artist = liveTitle == nil ? liveArtist ?? cached?.artist : liveArtist
        let raw = liveTitle.map { title in
            [liveArtist, title]
                .compactMap { $0 }
                .joined(separator: " - ")
        } ?? cached?.raw ?? liveProgramName ?? station.name

        return NowPlayingMetadata(
            artist: artist,
            title: title,
            raw: raw,
            programName: liveProgramName ?? cached?.programName,
            programSubtitle: liveProgramSubtitle ?? cached?.programSubtitle,
            coverUrl: coverUrl,
        )
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

    @ViewBuilder
    private var stationListDeleteModeDismissBackground: some View {
        if stationListDeleteModeEnabled {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture {
                    hideStationListDeleteMode()
                }
        }
    }

    private func cleanInfoValue(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    private var canReorderFavorites: Bool {
        isFavoritesPage
            && !showingFavoritesCatalogFallback
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !hasActiveFiltersForCurrentSource
    }

    private var canUseStationListDeleteMode: Bool {
        canDeleteStationListsOverview || canDeleteStationsFromSelectedList
    }

    private var canDeleteStationListsOverview: Bool {
        isLibraryHome
            && !library.stationLists.isEmpty
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canDeleteStationsFromSelectedList: Bool {
        isStationListsDetail
            && selectedStationList?.stations.isEmpty == false
            && query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isStationListStationDeleteMode: Bool {
        stationListDeleteModeEnabled && canDeleteStationsFromSelectedList
    }

    private func moveFavoriteRows(from source: IndexSet, to destination: Int) {
        guard canReorderFavorites else { return }
        filterTask?.cancel()

        var ordered = filteredStations
        ordered.move(fromOffsets: source, toOffset: destination)
        filteredStations = ordered
        library.reorderFavorites(ordered.map(\.id))
    }

    private func moveFavoriteGridStation(
        _ draggedID: String,
        relativeTo targetID: String,
        location: CGPoint,
        targetSize: CGSize?,
        dropBehavior: FavoriteGridDropBehavior,
    ) -> Bool {
        guard canReorderFavorites,
              draggedID != targetID,
              let sourceIndex = filteredStations.firstIndex(where: { $0.id == draggedID }),
              let targetIndex = filteredStations.firstIndex(where: { $0.id == targetID }) else { return false }
        let placement = favoriteGridDropPlacement(
            sourceIndex: sourceIndex,
            targetIndex: targetIndex,
            location: location,
            targetSize: targetSize,
            dropBehavior: dropBehavior,
        )
        guard let placement else { return false }

        let destination = placement == .after ? targetIndex + 1 : targetIndex
        guard destination != sourceIndex,
              destination != sourceIndex + 1 else { return false }

        filterTask?.cancel()

        var ordered = filteredStations
        // Spring instead of easeInOut: drag-hover fires many moves per
        // second, and an easeInOut tween locks each one in for its full
        // duration so consecutive moves stack on top of each other and
        // the row chases the finger. A spring of this response/damping
        // is what iOS Home / Settings reorder uses — overlapping moves
        // supersede smoothly instead of queueing.
        withAnimation(.spring(response: 0.28, dampingFraction: 0.78)) {
            ordered.move(fromOffsets: IndexSet(integer: sourceIndex), toOffset: destination)
            filteredStations = ordered
        }
        library.reorderFavorites(ordered.map(\.id))
        // Per-move selection haptic so each "slot crossed" is confirmed
        // to the user the moment the array changes, instead of waiting
        // for the spring to settle. Matches the SpringBoard reorder feel.
        UISelectionFeedbackGenerator().selectionChanged()
        return true
    }

    private func favoriteGridDropPlacement(
        sourceIndex: Int,
        targetIndex: Int,
        location: CGPoint,
        targetSize: CGSize?,
        dropBehavior: FavoriteGridDropBehavior,
    ) -> FavoriteGridDropPlacement? {
        guard sourceIndex != targetIndex else { return nil }
        switch dropBehavior {
        case .targetSlot:
            return targetIndex > sourceIndex ? .after : .before
        case .horizontalSplit:
            guard let targetSize,
                  targetSize.width > 0,
                  targetSize.height > 0 else {
                return targetIndex > sourceIndex ? .after : .before
            }

            let horizontalProgress = min(max(location.x / targetSize.width, 0), 1)
            return horizontalProgress < 0.5 ? .before : .after
        }
    }

    private func updateFavoriteNowPlayingPolling() {
        guard isLibraryPage,
              !isLibraryHome,
              !showingFavoritesCatalogFallback,
              favoritesDisplayMode != .app else {
            favoriteNowPlaying.stop()
            return
        }
        switch librarySelection {
        case .home:
            favoriteNowPlaying.stop()
        case .favorites:
            favoriteNowPlaying.start(stations: library.favorites)
        case .recents:
            favoriteNowPlaying.start(stations: library.recents)
        case .stationList(let id):
            favoriteNowPlaying.start(stations: library.stationList(id: id)?.stations ?? [])
        }
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

                    if cancelTarget == .sleep {
                        HStack(spacing: 5) {
                            Text(title.lowercased())
                                .lineLimit(1)
                        }
                        .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink3)
                        .textCase(.lowercase)
                    }
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

    private var emptyTitle: String {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty || hasActiveFiltersForCurrentSource {
            return locale.text(.noStationsFound)
        }
        if isLibraryHome {
            return locale.text(.noStationLists)
        }
        if isStationListsDetail {
            return locale.text(.emptyStationList)
        }
        if isFavoritesPage {
            return locale.text(.noFavorites)
        }
        if isLibraryRecentsPage {
            return locale.text(.noRecents)
        }
        switch source {
        case .all: return locale.text(.catalogEmpty)
        case .favorites: return locale.text(.noFavorites)
        case .recents: return locale.text(.noRecents)
        }
    }

    private var emptyIcon: String {
        if hasActiveFiltersForCurrentSource { return "line.3.horizontal.decrease.circle" }
        if isLibraryHome { return "square.grid.2x2" }
        if isStationListsDetail { return "antenna.radiowaves.left.and.right.slash" }
        if isFavoritesPage { return "heart" }
        if isLibraryRecentsPage { return "clock" }
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
        if isLibraryHome {
            return locale.text(.stationListsHint)
        }
        if isStationListsDetail {
            return locale.text(.emptyStationListHint)
        }
        if isFavoritesPage {
            return locale.text(.tapHeart)
        }
        if isLibraryRecentsPage {
            return locale.text(.recentsHint)
        }
        switch source {
        case .all: return locale.text(.catalogNoRows)
        case .favorites: return locale.text(.tapHeart)
        case .recents: return locale.text(.recentsHint)
        }
    }

    private var statusLabel: String {
        if isLibraryPage {
            return librarySelectionTitle(librarySelection)
        }
        switch source {
        case .all:
            let filters = activeFilterLabels
            return filters.isEmpty ? locale.text(.allStations) : filters.joined(separator: " . ")
        case .favorites:
            let filters = activeFilterLabels
            return filters.isEmpty ? locale.text(.favorites) : filters.joined(separator: " . ")
        case .recents: return locale.text(.recents)
        }
    }

    private var statusCountLabel: String {
        if isLibraryPage {
            if isLibraryHome {
                return "\(filteredLibrarySelections.count)"
            }
            return "\(filteredStations.count)"
        }
        guard source == .all else { return "\(filteredStations.count)" }
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
        labels.append(contentsOf: activeBrowseFilterLabels)
        return labels
    }

    private var activeBrowseFilterLabels: [String] {
        var labels: [String] = []
        if newsFilterSelected {
            labels.append(locale.text(.news))
        }
        labels.append(contentsOf: selectedGenreIDs.sorted().compactMap { findGenre($0)?.label })
        for country in selectedCountryCodes.sorted() {
            labels.append(country.uppercased())
        }
        return labels
    }

    private var canLoadWorldwideStations: Bool {
        pageTab == .browse && source == .all && radioBrowserHasMore
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
        if isLibraryHome {
            filterTask?.cancel()
            showingFavoritesCatalogFallback = false
            filteredStations = []
            return
        }
        if isStationListsDetail {
            filterTask?.cancel()
            showingFavoritesCatalogFallback = false
            guard let selectedStationList else { return }
            let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            filteredStations = selectedStationList.stations.filter {
                trimmedQuery.isEmpty || stationMatches($0, query: query)
            }
            return
        }
        if isLibraryPage {
            filterTask?.cancel()
            let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            let stationFiltersApply = isFavoritesPage
            let selectedCountryCodes = stationFiltersApply ? selectedCountryCodes : []
            let selectedGenreIDs = stationFiltersApply ? selectedGenreIDs : []
            let newsFilterSelected = stationFiltersApply ? newsFilterSelected : false
            let matches = stations.filter {
                stationMatches($0, query: query)
                    && Self.stationMatchesBrowseFilters(
                        $0,
                        countryCodes: selectedCountryCodes,
                        genreIDs: selectedGenreIDs,
                        newsFilterSelected: newsFilterSelected,
                    )
            }
            if isFavoritesPage,
               !trimmedQuery.isEmpty,
               matches.isEmpty {
                let catalogMatches = catalog.browseOrdered.filter {
                    stationMatches($0, query: query)
                        && Self.stationMatchesBrowseFilters(
                            $0,
                            countryCodes: selectedCountryCodes,
                            genreIDs: selectedGenreIDs,
                            newsFilterSelected: newsFilterSelected,
                        )
                }
                filteredStations = catalogMatches
                showingFavoritesCatalogFallback = !catalogMatches.isEmpty
            } else {
                filteredStations = matches
                showingFavoritesCatalogFallback = false
            }
            return
        }
        let source = source
        let stationFiltersApply = source == .all || source == .favorites
        let selectedCountryCodes = stationFiltersApply ? selectedCountryCodes : []
        let selectedGenreIDs = stationFiltersApply ? selectedGenreIDs : []
        let newsFilterSelected = stationFiltersApply ? newsFilterSelected : false
        let stations = stations
        let catalogStations = allStations
        let customStations = library.customStations
        let searchIndex = catalog.searchIndex
        let browseStationSort = source == .all ? browseStationSort : nil
        let favoriteIDs = Set(library.favorites.map(\.id))
        let radioBrowserStations = radioBrowserStations
        let searchResultLimit = searchResultLimit
        let stationPageSize = stationPageSize
        filterTask?.cancel()
        filterTask = Task.detached(priority: .userInitiated) {
            let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
            let resultSort = trimmedQuery.isEmpty ? browseStationSort : nil
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
                        sort: resultSort,
                        favoriteIDs: favoriteIDs,
                    )
                    showingFavoritesCatalogFallback = false
                }
                matches = Self.searchIndexedStations(
                    query: trimmedQuery,
                    selectedCountryCodes: selectedCountryCodes,
                    selectedGenreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
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
                sort: resultSort,
                favoriteIDs: favoriteIDs,
            )
            await MainActor.run {
                filteredStations = sortedMatches
                showingFavoritesCatalogFallback = showFavoritesCatalogFallback && !matches.isEmpty
            }
        }
    }

    nonisolated private static func stationListMatches(_ list: StationList, query: String) -> Bool {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else { return true }
        if list.name.localizedCaseInsensitiveContains(trimmedQuery) {
            return true
        }
        return list.stations.contains { stationMatches($0, query: trimmedQuery) }
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
            let fallbackStations = uniqueStations(catalogStations + customStations + radioBrowserStations)
            return fallbackStations.filter {
                stationMatches($0, query: query)
                    && stationMatchesBrowseFilters(
                        $0,
                        countryCodes: selectedCountryCodes,
                        genreIDs: selectedGenreIDs,
                        newsFilterSelected: newsFilterSelected,
                    )
            }
        }

        let catalogSubstringMatches = catalogStations.filter {
            stationMatches($0, query: query)
                && stationMatchesBrowseFilters(
                    $0,
                    countryCodes: selectedCountryCodes,
                    genreIDs: selectedGenreIDs,
                    newsFilterSelected: newsFilterSelected,
                )
        }
        let sideMatches = (customStations + radioBrowserStations).filter {
            stationMatches($0, query: query)
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
        guard source == .all else { return }
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
        if isLibraryHome {
            return locale.text(.searchStationLists)
        }
        if isStationListsDetail {
            return isStationListsDetail ? locale.text(.searchStationList) : locale.text(.searchStationLists)
        }
        if isFavoritesPage {
            return locale.text(.searchFavorites)
        }
        if isLibraryRecentsPage {
            return locale.text(.searchRecents)
        }
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

    private func clearSearchState() {
        searchUpdateTask?.cancel()
        searchText = ""
        query = ""
        searchFocused = false
        favoritesSearchPresented = false
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

private enum FavoriteGridDropPlacement {
    case before
    case after
}

private enum FavoriteGridDropBehavior {
    case horizontalSplit
    case targetSlot
}

/// SpringBoard-style jiggle modifier for the favorites grid icons.
/// Active when the user is in delete mode; off otherwise.
///
/// Implementation note: this used to be `@State + withAnimation(...).
/// repeatForever`, which is the canonical SwiftUI pattern but is
/// fragile inside a ViewModifier — the parent reconstructs the
/// modifier on every render (because `isActive` is part of its init),
/// and the @State / animation lifecycle around that can drop the
/// repeat without warning. TimelineView with time-driven sin/cos is
/// deterministic: each frame computes the rotation from absolute
/// time, guaranteed to run regardless of modifier reconstruction.
///
/// Each tile passes `station.id.hashValue` as `seed`, which seeds a
/// small per-tile period offset and a phase shift — adjacent tiles
/// jiggle at slightly different rates so the eye reads it as many
/// independent icons rather than one rigid grid shaking together.
private struct FavoriteJiggleModifier: ViewModifier {
    let isActive: Bool
    let seed: Int

    // Rotation amplitude tuned to be unmistakably "edit mode" but not
    // cartoonish. iPhone SpringBoard runs closer to ~3°; that reads
    // shaky on a 64-pt app tile and is too much on a 46-pt list cell.
    private static let rotationDegrees: Double = 2.4
    private static let translationPixels: Double = 1.0
    // Baseline ~280 ms full cycle. Per-tile jitter spreads tiles
    // across a 280–340 ms band so they don't beat in unison.
    private var period: Double { 0.28 + Double(abs(seed) % 60) / 1000.0 }
    private var phaseOffset: Double {
        (Double(abs(seed) % 100) / 100.0) * .pi * 2
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if isActive {
            TimelineView(.animation) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                let phase = (t / period) * 2 * .pi + phaseOffset
                content
                    .rotationEffect(.degrees(sin(phase) * Self.rotationDegrees))
                    // Translation uses `cos` so it's 90° out of phase
                    // with the rotation — a tiny organic wobble
                    // instead of a pure rotation-around-center.
                    .offset(y: cos(phase) * Self.translationPixels)
            }
        } else {
            content
                .rotationEffect(.zero)
                .offset(.zero)
                .animation(.easeOut(duration: 0.18), value: isActive)
        }
    }
}

private struct FavoriteStationDropDelegate: DropDelegate {
    // Minimum gap between successful reorders during a single drag.
    // Previously the gate was "ignore the same target ID until the
    // finger leaves it", which locked out back-and-forth across a
    // single boundary. A time-based throttle lets fine adjustments
    // through while still preventing the array from being thrashed at
    // dropUpdated's call rate.
    static let moveThrottleInterval: TimeInterval = 0.08

    let targetStationID: String
    let targetSize: CGSize?
    let dropBehavior: FavoriteGridDropBehavior
    @Binding var draggedStationID: String?
    @Binding var targetedStationID: String?
    @Binding var lastMoveAt: Date?
    let moveStation: (String, String, CGPoint, CGSize?, FavoriteGridDropBehavior) -> Bool

    func validateDrop(info: DropInfo) -> Bool {
        draggedStationID != nil
    }

    func dropEntered(info: DropInfo) {
        moveIfReady(info: info)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        moveIfReady(info: info)
        return DropProposal(operation: .move)
    }

    private func moveIfReady(info: DropInfo) {
        guard let draggedStationID,
              draggedStationID != targetStationID else { return }
        if let lastMoveAt,
           Date().timeIntervalSince(lastMoveAt) < Self.moveThrottleInterval {
            return
        }
        guard moveStation(draggedStationID, targetStationID, info.location, targetSize, dropBehavior) else { return }
        targetedStationID = targetStationID
        lastMoveAt = Date()
    }

    func dropExited(info: DropInfo) {
        if targetedStationID == targetStationID {
            targetedStationID = nil
        }
    }

    func performDrop(info: DropInfo) -> Bool {
        let handled = draggedStationID != nil
        clearDragState()
        return handled
    }

    private func clearDragState() {
        draggedStationID = nil
        targetedStationID = nil
        lastMoveAt = nil
    }
}

private struct FavoriteGridDropResetDelegate: DropDelegate {
    @Binding var draggedStationID: String?
    @Binding var targetedStationID: String?
    @Binding var lastMoveAt: Date?

    func validateDrop(info: DropInfo) -> Bool {
        draggedStationID != nil
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
        targetedStationID = nil
        lastMoveAt = nil
    }

    func performDrop(info: DropInfo) -> Bool {
        let handled = draggedStationID != nil
        clearDragState()
        return handled
    }

    private func clearDragState() {
        draggedStationID = nil
        targetedStationID = nil
        lastMoveAt = nil
    }
}

func stationHasProgramInfo(_ station: Station) -> Bool {
    if scheduleFetcher(for: station) != nil {
        return true
    }
    switch station.metadata?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "srr", "br-radioplayer", "bbc", "hr", "rb-bremen", "sr":
        return true
    default:
        return false
    }
}

private extension View {
    @ViewBuilder
    func currentStationInnerHighlight(isCurrent: Bool, cornerRadius: CGFloat) -> some View {
        if isCurrent {
            self
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
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            self
        }
    }
}

struct StationRow: View {
    enum Mode {
        case standard
        case favoritesListCard
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
    var showsStreamQualityButton = true
    var onInfoHoldChanged: ((Bool) -> Void)?
    var shouldSuppressActivation: () -> Bool = { false }
    @State private var showingStreamQuality = false
    @State private var infoPressRecognized = false
    @State private var suppressNextPlay = false
    private let trailingControlSize: CGFloat = 36
    private let trailingControlSpacing: CGFloat = 8
    private var rowContentTrailingPadding: CGFloat {
        mode == .standard ? 6 : 14
    }
    private var usesFavoritesMetadataLayout: Bool {
        mode == .favoritesListCard || mode == .favoritesExpanded
    }
    private var usesCardBackground: Bool {
        mode == .standard || mode == .favoritesListCard
    }
    private var usesTopSeparator: Bool {
        mode == .favoritesExpanded
    }
    private var usesCurrentCardHighlight: Bool {
        usesCardBackground && isCurrent
    }

    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: usesFavoritesMetadataLayout ? 16 : 14) {
                rowArtwork
                rowText
                    .frame(maxWidth: .infinity, alignment: .leading)

                if usesFavoritesMetadataLayout {
                    expandedCoverArtworkSlot
                        .frame(width: expandedCoverArtworkSize, height: expandedCoverArtworkSize)
                        .layoutPriority(1)
                }
                if isPlaying && !usesFavoritesMetadataLayout {
                    EqualizerView()
                }
            }
            .frame(minHeight: usesFavoritesMetadataLayout ? 72 : 38)
            // Dim the artwork + text body when this station is
            // geo-restricted away from the user's region. We still
            // let them tap (in case they're VPN'd to CH or the
            // CF-IPCountry lookup misread their region); the player
            // then surfaces the friendly restriction message if the
            // stream fails.
            .opacity(isGeoRestricted ? 0.6 : 1)
            .contentShape(Rectangle())
            .onTapGesture {
                if suppressNextPlay {
                    suppressNextPlay = false
                    return
                }
                guard !shouldSuppressActivation() else { return }
                onPlay()
            }
            .accessibilityAddTraits(.isButton)

            trailingControls
        }
        .padding(.leading, 20)
        .padding(.trailing, rowContentTrailingPadding)
        .padding(.vertical, usesFavoritesMetadataLayout ? 16 : 14)
        .alert("Stream quality", isPresented: $showingStreamQuality) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(streamQualityMessage)
        }
        .background {
            if usesCardBackground {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(usesCurrentCardHighlight ? RrradioTheme.bg3 : RrradioTheme.bg2)
                    .overlay {
                        if usesCurrentCardHighlight {
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .stroke(RrradioTheme.line, lineWidth: 1)
                        }
                    }
                    .currentStationInnerHighlight(isCurrent: usesCurrentCardHighlight, cornerRadius: 6)
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
            if isCurrent && !usesCardBackground {
                Rectangle()
                    .fill(RrradioTheme.accent)
                    .frame(width: 2)
            }
        }
        .overlay(alignment: .top) {
            if usesTopSeparator {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(maxWidth: .infinity)
                    .frame(height: 1)
            }
        }
        .padding(.horizontal, usesCardBackground ? 14 : 0)
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
        if (mode == .standard && showsStreamQualityButton) || showsFavoriteButton {
            HStack(spacing: trailingControlSpacing) {
                if mode == .standard && showsStreamQualityButton {
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
                guard !shouldSuppressActivation() else { return }
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
        let artworkSize: CGFloat = usesFavoritesMetadataLayout ? 46 : 38
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
        if usesFavoritesMetadataLayout {
            VStack(alignment: .leading, spacing: 4) {
                stationTitleLine
                if let trackLine {
                    detailText(trackLine, style: .primary)
                } else if let headlineLine {
                    detailText(headlineLine, style: .primary)
                }
                if let programInfoLine {
                    detailText(programInfoLine, style: .secondary)
                }
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
                Text(usesFavoritesMetadataLayout ? station.name : primaryLine)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                    .lineLimit(1)
                let flag = countryFlagEmoji(station.country)
                if !flag.isEmpty {
                    Text(flag)
                        .font(.system(size: 12))
                        .foregroundStyle(.primary)
                }
                if hasProgramInfo {
                    Image(systemName: "calendar")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink3)
                        .accessibilityLabel("Program info")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
        }
    }

    @ViewBuilder
    private var stationTagLine: some View {
        HStack(spacing: 6) {
            if let label = geoRestrictionLabel {
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color(red: 0.94, green: 0.72, blue: 0.36))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color(red: 1.0, green: 0.72, blue: 0.30).opacity(0.16)),
                    )
                    .lineLimit(1)
                    .accessibilityLabel("Geo-restricted: \(label)")
            }
            if isCustom {
                Text("added station")
                    .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .textCase(.lowercase)
                    .lineLimit(1)
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

    /// Non-nil when the station has a curated `availableIn` allow-list
    /// and the visitor's region (per RegionResolver) is outside it.
    /// Touching `RegionResolver.shared.current` here means SwiftUI
    /// observation re-renders the row when the fetch resolves.
    private var geoRestrictionLabel: String? {
        RegionResolver.shared.restrictionLabel(station, countryName: countryDisplayName)
    }

    /// True when the station has a geo-restriction and the visitor
    /// isn't inside the allow-list. Drives the dimmed appearance.
    private var isGeoRestricted: Bool {
        !RegionResolver.shared.isAvailable(station)
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
            .lineLimit(detailLineLimit(for: style))
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
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

    private func detailLineLimit(for style: DetailTextStyle) -> Int {
        switch style {
        case .primary, .secondary:
            usesFavoritesMetadataLayout ? 2 : 1
        case .mono:
            1
        }
    }

    @ViewBuilder
    private var expandedCoverArtworkSlot: some View {
        if expandedArtworkURL != nil {
            expandedCoverArtwork
        } else {
            Color.clear
                .accessibilityHidden(true)
        }
    }

    private var expandedCoverArtwork: some View {
        NowPlayingArtworkThumb(
            url: nowPlaying?.coverUrl,
            size: expandedCoverArtworkSize,
            showsBorder: false,
        )
    }

    private var expandedCoverArtworkSize: CGFloat {
        64
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

    private var hasProgramInfo: Bool {
        stationHasProgramInfo(station)
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

private struct FavoriteStationTile: View {
    let station: Station
    var nowPlaying: NowPlayingMetadata?
    let isCurrent: Bool
    let isPlaying: Bool
    let isCustom: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                artwork(size: 46)
                Spacer(minLength: 6)
                topRightArtwork
            }

            VStack(alignment: .leading, spacing: 4) {
                titleLine
                tileMetadataLines
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 142, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isCurrent ? RrradioTheme.bg3 : RrradioTheme.bg2)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(RrradioTheme.line)
        }
        .currentStationInnerHighlight(isCurrent: isCurrent, cornerRadius: 6)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private var titleLine: some View {
        HStack(spacing: 4) {
            Text(station.name)
                .font(.system(size: 14.5, weight: .medium))
                .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                .lineLimit(1)
            let flag = countryFlagEmoji(station.country)
            if !flag.isEmpty {
                Text(flag)
                    .font(.system(size: 11))
                    .foregroundStyle(.primary)
            }
            if stationHasProgramInfo(station) {
                Image(systemName: "calendar")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink3)
                    .accessibilityLabel("Program info")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var tileMetadataLines: some View {
        if let trackLine {
            tileDetailText(trackLine, color: RrradioTheme.ink2, lineLimit: 2)
        } else if let headlineLine {
            tileDetailText(headlineLine, color: RrradioTheme.ink2, lineLimit: 2)
        }

        if let programInfoLine {
            tileDetailText(programInfoLine, color: RrradioTheme.ink3, lineLimit: 2)
        } else if trackLine == nil && headlineLine == nil, let fallbackDetailLine {
            tileDetailText(fallbackDetailLine, color: RrradioTheme.ink3, lineLimit: 2)
        }
    }

    @ViewBuilder
    private var topRightArtwork: some View {
        if let coverUrl = nowPlaying?.coverUrl {
            NowPlayingArtworkThumb(
                url: coverUrl,
                size: 46,
                showsBorder: false,
            )
        } else if isPlaying {
            EqualizerView()
                .padding(.top, 4)
        }
    }

    private func tileDetailText(_ value: String, color: Color, lineLimit: Int) -> some View {
        Text(value)
            .font(.system(size: 11.5))
            .foregroundStyle(color)
            .lineLimit(lineLimit)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
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

    private var fallbackDetailLine: String? {
        if let program = clean(nowPlaying?.programName) {
            if let subtitle = clean(nowPlaying?.programSubtitle) {
                return "\(program) . \(subtitle)"
            }
            return program
        }
        if isCustom {
            return "added station"
        }
        return station.tags?.prefix(2).joined(separator: " . ").nilIfEmpty
    }

    @ViewBuilder
    private func artwork(size: CGFloat) -> some View {
        if isCustom {
            LocalStationArtworkView(size: size)
                .frame(width: size, height: size)
        } else {
            FaviconView(url: station.favicon, stationName: station.name, stationID: station.id, size: size)
                .frame(width: size, height: size)
        }
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
}

private struct FavoriteStationAppIcon: View {
    let station: Station
    let isCurrent: Bool
    let isCustom: Bool
    let dragProvider: (() -> NSItemProvider)?
    private let labelHeight: CGFloat = 32
    private var labelWidth: CGFloat { FavoriteStationAppArtwork.iconSize }
    private var cellHeight: CGFloat { FavoriteStationAppArtwork.iconSize + 8 + labelHeight }

    var body: some View {
        VStack(spacing: 8) {
            artwork
            Text(station.name)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .truncationMode(.tail)
                .frame(width: labelWidth, height: labelHeight, alignment: .top)
                .frame(maxWidth: .infinity)
        }
        .frame(height: cellHeight, alignment: .top)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .bottom) {
            if isCurrent {
                Rectangle()
                    .fill(RrradioTheme.accent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 2)
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var artwork: some View {
        if let dragProvider {
            FavoriteStationAppArtwork(
                station: station,
                isCurrent: isCurrent,
                isCustom: isCustom,
            )
            .onDrag {
                dragProvider()
            } preview: {
                FavoriteStationAppArtwork(
                    station: station,
                    isCurrent: isCurrent,
                    isCustom: isCustom,
                )
                .modifier(FavoriteJiggleModifier(isActive: true, seed: station.id.hashValue))
            }
        } else {
            FavoriteStationAppArtwork(
                station: station,
                isCurrent: isCurrent,
                isCustom: isCustom,
            )
        }
    }
}

private struct FavoriteStationAppArtwork: View {
    static let iconSize: CGFloat = 64
    static let iconCornerRadius: CGFloat = 15

    let station: Station
    let isCurrent: Bool
    let isCustom: Bool

    @ViewBuilder
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Self.iconCornerRadius, style: .continuous)
                .fill(isCustom ? RrradioTheme.bg2 : Color.white)
            if isCustom {
                Image(systemName: "house.fill")
                    .font(.system(size: Self.iconSize * 0.40, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink3)
            } else if let url = station.favicon {
                CachedRemoteImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(width: Self.iconSize, height: Self.iconSize)
                        .clipped()
                } placeholder: {
                    initials
                }
            } else {
                initials
            }
        }
        .frame(width: Self.iconSize, height: Self.iconSize)
        .clipShape(RoundedRectangle(cornerRadius: Self.iconCornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Self.iconCornerRadius, style: .continuous)
                .stroke(RrradioTheme.line)
        }
        .contentShape(.dragPreview, RoundedRectangle(cornerRadius: Self.iconCornerRadius, style: .continuous))
        .accessibilityHidden(true)
    }

    private var initials: some View {
        Text(stationInitials(station.name))
            .font(.system(size: 22, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color.black)
            .frame(width: Self.iconSize, height: Self.iconSize)
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
    var showsBorder = true

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(RrradioTheme.bg2)
            if let url {
                CachedRemoteImage(url: url) { image in
                    image
                        .resizable()
                        .scaledToFit()
                        .padding(1)
                } placeholder: {
                    Color.clear
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay {
            if showsBorder {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(RrradioTheme.line)
            }
        }
        .shadow(color: Color.gray.opacity(0.23), radius: 7, x: 0, y: 3)
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

private struct StationListCard: View {
    let stationList: StationList
    let emptyLabel: String
    let isCurrent: Bool
    let isFirstStationCustom: Bool
    let isDeleteModeEnabled: Bool
    let onOpen: () -> Void
    let onPlay: () -> Void
    let onDelete: () -> Void

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(action: onPlay) {
                HStack(spacing: 14) {
                    leadingArtwork

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 7) {
                            Text(stationList.name)
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                                .lineLimit(1)
                                .layoutPriority(1)

                            stationCountBadge
                                .fixedSize()
                        }

                        Text(summaryLine)
                            .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                            .foregroundStyle(RrradioTheme.ink3)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Color.clear
                        .frame(width: isDeleteModeEnabled ? 56 : 36)
                        .accessibilityHidden(true)
                }
                .padding(.leading, 20)
                .padding(.trailing, 14)
                .padding(.vertical, 14)
                .background {
                    cardBackground
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                stationList.stations.isEmpty ? "\(stationList.name), empty list" : "Play \(stationList.name)"
            )

            if isDeleteModeEnabled {
                deleteButton
                    .padding(.trailing, 20)
                    .transition(.scale(scale: 0.82).combined(with: .opacity))
            } else {
                openButton
                    .padding(.trailing, 6)
            }
        }
        .animation(.snappy(duration: 0.16), value: isDeleteModeEnabled)
    }

    @ViewBuilder
    private var leadingArtwork: some View {
        if let firstStation {
            if isFirstStationCustom {
                LocalStationArtworkView(size: 38)
            } else {
                FaviconView(url: firstStation.favicon, stationName: firstStation.name, stationID: firstStation.id, size: 38)
                    .frame(width: 38, height: 38)
            }
        } else {
            Image(systemName: "list.bullet.rectangle")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink3)
                .frame(width: 38, height: 38)
                .background(RrradioTheme.bg)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(RrradioTheme.line)
                }
        }
    }

    private var stationCountBadge: some View {
        Text("\(stationList.stations.count)")
            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
            .foregroundStyle(RrradioTheme.ink3)
            .frame(minWidth: 22, minHeight: 22)
            .background(RrradioTheme.bg)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(RrradioTheme.line))
    }

    private var openButton: some View {
        Button(action: onOpen) {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(RrradioTheme.ink4)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Show stations in \(stationList.name)")
    }

    private var deleteButton: some View {
        Button(action: onDelete) {
            Image(systemName: "minus.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(stationList.name)")
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(isCurrent ? RrradioTheme.bg3 : RrradioTheme.bg2)
            .currentStationInnerHighlight(isCurrent: isCurrent, cornerRadius: 6)
    }

    private var firstStation: Station? {
        stationList.stations.first
    }

    private var summaryLine: String {
        guard !stationList.stations.isEmpty else { return emptyLabel }
        return stationList.stations.prefix(3).map(\.name).joined(separator: " . ")
    }
}

private struct LibrarySelectionCard: View {
    let title: String
    let icon: String
    let count: Int
    let summary: String
    let isCurrent: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink3)
                    .frame(width: 38, height: 38)
                    .background(RrradioTheme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(RrradioTheme.line)
                    }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 7) {
                        Text(title)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                            .lineLimit(1)
                            .layoutPriority(1)

                        Text("\(count)")
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(RrradioTheme.ink3)
                            .frame(minWidth: 22, minHeight: 22)
                            .background(RrradioTheme.bg)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(RrradioTheme.line))
                    }

                    Text(summary)
                        .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(RrradioTheme.ink4)
                    .frame(width: 36, height: 36)
            }
            .padding(.leading, 20)
            .padding(.trailing, 6)
            .padding(.vertical, 14)
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isCurrent ? RrradioTheme.bg3 : RrradioTheme.bg2)
                    .currentStationInnerHighlight(isCurrent: isCurrent, cornerRadius: 6)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
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
}
