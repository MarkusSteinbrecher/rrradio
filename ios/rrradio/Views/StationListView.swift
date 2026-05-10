import SwiftUI
import UIKit

enum RrradioTheme {
    static let accent = adaptive(
        light: UIColor(red: 0, green: 0.627, blue: 0.251, alpha: 1),
        dark: UIColor(red: 1, green: 1, blue: 0, alpha: 1),
    )
    static let bg = adaptive(
        light: UIColor(red: 0.973, green: 0.973, blue: 0.953, alpha: 1),
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
    @State private var librarySource: StationSource = .favorites
    @State private var showingSettings = false
    @State private var showingMap = false
    @State private var showingNowPlaying = false
    @State private var showingWakeAlarm = false
    @State private var timerCancelConfirmation: TimerCancelTarget?
    @State private var checkedOnly = true
    @State private var selectedCountry: String?
    @State private var selectedTag: String?
    @State private var activeFilterPicker: ActiveFilterPicker?
    @State private var stationDisplayLimit = 220
    @State private var radioBrowserStations: [Station] = []
    @State private var radioBrowserTotalCount: Int?
    @State private var radioBrowserOffset = 0
    @State private var radioBrowserHasMore = true
    @State private var radioBrowserLoading = false
    @State private var filteredStations: [Station] = []
    @State private var filterTask: Task<Void, Never>?
    @State private var searchUpdateTask: Task<Void, Never>?
    @State private var radioBrowserSearchTask: Task<Void, Never>?
    @State private var favoriteNowPlaying = FavoriteNowPlayingStore()
    @State private var listScrollOffset: CGFloat = 0
    @State private var stationInfoPreview: Station?
    @State private var stationInfoPreviewMetadata: [String: NowPlayingMetadata] = [:]
    @State private var stationInfoMetadataTask: Task<Void, Never>?
    @FocusState private var searchFocused: Bool

    private let stationPageSize = 220
    private let statusCollapseDistance: CGFloat = 26
    private let filterCollapseDistance: CGFloat = 52
    private let browseControlsExpandedHeight: CGFloat = 78

    private enum ActiveFilterPicker {
        case genre
        case country
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
    ) {
        _tab = tab
        _searchFocusedExternally = searchFocusedExternally
    }

    private var allStations: [Station] { catalog.browseOrdered }
    private var stationPool: [Station] {
        checkedOnly ? allStations : allStations + radioBrowserStations
    }
    private var countries: [String] { availableCountries(from: allStations) }
    private var genres: [Genre] { availableGenres(from: allStations) }

    private var stations: [Station] {
        switch source {
        case .all:
            checkedOnly ? allStations.filter(isCheckedStation) : stationPool
        case .favorites: library.favorites
        case .recents: library.recents
        }
    }

    private var displayLimit: Int {
        min(stationDisplayLimit, filteredStations.count)
    }

    private var visibleStations: [Station] { Array(filteredStations.prefix(displayLimit)) }
    private var hasActiveFilters: Bool { selectedCountry != nil || selectedTag != nil }
    private var isFavoritesPage: Bool {
        tab == .library && source == .favorites
    }
    private var filterSignature: String {
        [
            source.rawValue,
            query,
            selectedCountry ?? "",
            selectedTag ?? "",
            checkedOnly ? "checked" : "all",
            "\(catalog.browseOrdered.count)",
            "\(library.favorites.count)",
            "\(library.recents.count)",
            "\(library.customStations.count)",
            "\(radioBrowserStations.count)",
        ].joined(separator: "\u{1f}")
    }

    var body: some View {
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
        .background(RrradioTheme.bg)
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        .sheet(isPresented: $showingMap) {
            StationMapView(
                stations: allStations,
                selectedCountry: $selectedCountry,
                onSelectCountry: { country in
                    source = .all
                    selectedCountry = country
                    checkedOnly = false
                },
                onOpenStation: { station in
                    player.play(station)
                    library.pushRecent(station)
                    showingMap = false
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 250_000_000)
                        showingNowPlaying = true
                    }
                },
            )
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
            timerCancelConfirmation?.title ?? "",
            isPresented: Binding(
                get: { timerCancelConfirmation != nil },
                set: { if !$0 { timerCancelConfirmation = nil } },
            ),
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
        .onChange(of: tab) { _, value in
            switch value {
            case .browse:
                source = .all
            case .library:
                source = librarySource
            }
        }
        .onChange(of: source) { _, value in
            resetStationDisplayLimit()
            listScrollOffset = 0
            if value == .all {
                tab = .browse
            } else {
                librarySource = value
                tab = .library
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
        .onChange(of: selectedCountry) { _, _ in
            resetStationDisplayLimit()
            resetRadioBrowserStations()
            fetchInitialRadioBrowserPageIfNeeded()
        }
        .onChange(of: selectedTag) { _, _ in
            resetStationDisplayLimit()
            resetRadioBrowserStations()
            fetchInitialRadioBrowserPageIfNeeded()
        }
        .onChange(of: checkedOnly) { _, _ in
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
        .onDisappear {
            filterTask?.cancel()
            searchUpdateTask?.cancel()
            radioBrowserSearchTask?.cancel()
            stationInfoMetadataTask?.cancel()
            favoriteNowPlaying.stop()
            searchFocusedExternally = false
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
            searchField
            collapsibleRegularControls
        }
        .topbarChrome(top: 14, bottom: 10)
        .collapsingTopbarDivider(opacity: topbarDividerOpacity)
    }

    private var compactTopbar: some View {
        VStack(spacing: 8) {
            brandActionsRow
            compactCollapsibleControls
        }
        .topbarChrome(top: 8, bottom: 6)
        .collapsingTopbarDivider(opacity: topbarDividerOpacity)
    }

    private var topbarCollapse: CGFloat {
        min(max(listScrollOffset, 0), statusCollapseDistance + filterCollapseDistance)
    }

    private var topbarDividerOpacity: CGFloat {
        min(max(topbarCollapse / 8, 0), 1)
    }

    private var statusCollapseProgress: CGFloat {
        min(topbarCollapse / statusCollapseDistance, 1)
    }

    private var filterCollapseProgress: CGFloat {
        min(max((topbarCollapse - statusCollapseDistance) / filterCollapseDistance, 0), 1)
    }

    private var collapsibleRegularControls: some View {
        VStack(spacing: 14) {
            topbarControlRow
                .offset(y: -filterCollapseProgress * filterCollapseDistance)
                .opacity(1 - filterCollapseProgress)
            statusToolbar
                .offset(y: -statusCollapseProgress * statusCollapseDistance)
                .opacity(1 - statusCollapseProgress)
        }
        .frame(
            height: max(0, browseControlsExpandedHeight - topbarCollapse),
            alignment: .top,
        )
        .clipped()
        .allowsHitTesting(filterCollapseProgress < 0.8)
    }

    @ViewBuilder
    private var topbarControlRow: some View {
        if tab == .browse {
            filterRow
        } else {
            librarySegments
        }
    }

    private var compactCollapsibleControls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                searchField
                    .frame(minWidth: 220, maxWidth: .infinity)
                compactTopbarControlRow
                    .frame(maxWidth: .infinity)
                    .offset(y: -filterCollapseProgress * 38)
                    .opacity(1 - filterCollapseProgress)
                    .frame(width: max(0, (1 - filterCollapseProgress) * 180), alignment: .trailing)
                    .clipped()
                    .allowsHitTesting(filterCollapseProgress < 0.8)
            }

            statusToolbar
                .offset(y: -statusCollapseProgress * statusCollapseDistance)
                .opacity(1 - statusCollapseProgress)
                .frame(height: max(0, 12 - statusCollapseProgress * 12), alignment: .top)
                .clipped()
        }
    }

    @ViewBuilder
    private var compactTopbarControlRow: some View {
        if tab == .browse {
            compactFilterRow
        } else {
            librarySegments
        }
    }

    private var brandActionsRow: some View {
        HStack(alignment: .center) {
            Button {
                searchText = ""
                query = ""
                searchFocused = false
                source = .all
                selectedCountry = nil
                selectedTag = nil
                checkedOnly = true
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

            HStack(spacing: 8) {
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
            if !searchText.isEmpty {
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
                .accessibilityLabel(locale.text(.clearSearch))
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 9)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
    }

    private var filterRow: some View {
        GeometryReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    filterCell(locale.text(.checked)) {
                        circularFilterButton(
                            icon: "star.fill",
                            active: source == .all && checkedOnly,
                        ) {
                            source = .all
                            dismissSearch()
                            checkedOnly.toggle()
                            activeFilterPicker = nil
                        }
                    }
                    filterCell(locale.text(.news)) {
                        circularFilterButton(icon: "newspaper", active: selectedTag == "news") {
                            source = .all
                            dismissSearch()
                            selectedTag = selectedTag == "news" ? nil : "news"
                            activeFilterPicker = nil
                        }
                    }
                    filterCell(locale.text(.genre)) {
                        circularFilterButton(
                            icon: "music.note",
                            active: activeFilterPicker == .genre || (selectedTag != nil && selectedTag != "news"),
                        ) {
                            source = .all
                            dismissSearch()
                            activeFilterPicker = activeFilterPicker == .genre ? nil : .genre
                        }
                    }
                    filterCell(locale.text(.country)) {
                        circularFilterButton(
                            icon: "flag",
                            active: activeFilterPicker == .country || selectedCountry != nil,
                        ) {
                            source = .all
                            dismissSearch()
                            activeFilterPicker = activeFilterPicker == .country ? nil : .country
                        }
                    }
                    filterCell(locale.text(.map)) {
                        circularFilterButton(icon: "map", active: false) {
                            source = .all
                            dismissSearch()
                            activeFilterPicker = nil
                            showingMap = true
                        }
                    }
                }
                .padding(.horizontal, 1)
                .frame(minWidth: proxy.size.width, alignment: .center)
            }
        }
        .frame(height: 52)
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

    private var compactFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                circularFilterButton(
                    icon: "star.fill",
                    active: source == .all && checkedOnly,
                ) {
                    source = .all
                    dismissSearch()
                    checkedOnly.toggle()
                    activeFilterPicker = nil
                }
                .accessibilityLabel(locale.text(.checked))

                circularFilterButton(icon: "newspaper", active: selectedTag == "news") {
                    source = .all
                    dismissSearch()
                    selectedTag = selectedTag == "news" ? nil : "news"
                    activeFilterPicker = nil
                }
                .accessibilityLabel(locale.text(.news))

                circularFilterButton(
                    icon: "music.note",
                    active: activeFilterPicker == .genre || (selectedTag != nil && selectedTag != "news"),
                ) {
                    source = .all
                    dismissSearch()
                    activeFilterPicker = activeFilterPicker == .genre ? nil : .genre
                }
                .accessibilityLabel(locale.text(.genre))

                circularFilterButton(
                    icon: "flag",
                    active: activeFilterPicker == .country || selectedCountry != nil,
                ) {
                    source = .all
                    dismissSearch()
                    activeFilterPicker = activeFilterPicker == .country ? nil : .country
                }
                .accessibilityLabel(locale.text(.country))

                circularFilterButton(icon: "map", active: false) {
                    source = .all
                    dismissSearch()
                    activeFilterPicker = nil
                    showingMap = true
                }
                .accessibilityLabel(locale.text(.map))
            }
            .padding(.horizontal, 1)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(height: 38)
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
        if let activeFilterPicker {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 0) {
                        switch activeFilterPicker {
                        case .genre:
                            filterPickerRow(locale.text(.allGenres), selected: selectedTag == nil || selectedTag == "news") {
                                selectedTag = nil
                                self.activeFilterPicker = nil
                            }
                            ForEach(genres) { genre in
                                filterPickerRow(genre.label, selected: selectedTag == genre.id) {
                                    selectedTag = genre.id
                                    self.activeFilterPicker = nil
                                }
                            }
                        case .country:
                            filterPickerRow(locale.text(.allCountries), selected: selectedCountry == nil) {
                                selectedCountry = nil
                                self.activeFilterPicker = nil
                            }
                            ForEach(countries, id: \.self) { code in
                                filterPickerRow("\(countryDisplayName(code)) (\(code))", selected: selectedCountry == code) {
                                    selectedCountry = code
                                    self.activeFilterPicker = nil
                                }
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 6)
            }
            .frame(width: min(UIScreen.main.bounds.width - 44, 320), height: UIScreen.main.bounds.height * 0.7)
            .background(RrradioTheme.bg2)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(RrradioTheme.line)
            }
        }
    }

    private var librarySegments: some View {
        HStack(spacing: 4) {
            sourceButton(.favorites)
            sourceButton(.recents)
        }
        .padding(4)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
    }

    private var sectionStatus: some View {
        HStack(spacing: 8) {
            Text(statusLabel)
            Text(".")
                .foregroundStyle(RrradioTheme.ink4)
            Text(statusCountLabel)
                .foregroundStyle(RrradioTheme.ink4)
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .textCase(.uppercase)
        .tracking(1.5)
        .foregroundStyle(RrradioTheme.ink3)
        .frame(maxWidth: .infinity)
    }

    private var statusToolbar: some View {
        sectionStatus
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
        if isFavoritesPage {
            sortableFavoritesList
        } else {
            stationScrollList
        }
    }

    private var stationScrollList: some View {
        ScrollView {
            ScrollOffsetObserver(offset: $listScrollOffset)
                .frame(width: 0, height: 0)

            LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    ForEach(visibleStations) { station in
                        StationRow(
                            station: station,
                            nowPlaying: isFavoritesPage ? favoriteNowPlaying.entries[station.id]?.metadata : nil,
                            mode: isFavoritesPage ? .favoritesExpanded : .standard,
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
                            showsFavoriteButton: !isFavoritesPage,
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
            .padding(.bottom, 12)
        }
        .scrollDismissesKeyboard(.immediately)
        .refreshable {
            await catalog.refresh()
        }
        .background(RrradioTheme.bg)
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
                .moveDisabled(!canReorderFavorites)
            }
            .onMove(perform: moveFavoriteRows)

            if visibleStations.count < filteredStations.count {
                loadMoreRow
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(RrradioTheme.bg)
            }
        }
        .environment(\.editMode, .constant(.active))
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.immediately)
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
        isFavoritesPage && query.isEmpty && selectedCountry == nil && selectedTag == nil
    }

    private func moveFavoriteRows(from source: IndexSet, to destination: Int) {
        guard canReorderFavorites else { return }
        filterTask?.cancel()

        var ordered = filteredStations
        ordered.move(fromOffsets: source, toOffset: destination)
        filteredStations = ordered
        library.reorderFavorites(ordered.map(\.id))
    }

    private func updateFavoriteNowPlayingPolling() {
        guard isFavoritesPage else {
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
                    if sleepTimer.isArmed {
                        timerStatusRow(
                            icon: "moon.zzz.fill",
                            title: locale.text(.sleep),
                            detail: "in \(sleepTimer.countdownText(at: timeline.date))",
                            station: player.current,
                            cancelTarget: .sleep,
                        )
                    }
                }
            }
        }
    }

    private var hasTimerStatus: Bool {
        wakeAlarm.isArmed || sleepTimer.isArmed
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
                .frame(width: UIScreen.main.bounds.width, height: 2)
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.accent)
                .frame(width: UIScreen.main.bounds.width, height: 2)
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
        if station.metadata != nil { return 3 }
        if station.status == "icy-only" { return 2 }
        if station.status != nil { return 1 }
        return 0
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
        if hasActiveFilters { return "line.3.horizontal.decrease.circle" }
        switch source {
        case .all: return "antenna.radiowaves.left.and.right.slash"
        case .favorites: return "heart"
        case .recents: return "clock"
        }
    }

    private var emptyDescription: String {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty || hasActiveFilters {
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
        if checkedOnly { return "\(filteredStations.count)" }
        if hasActiveFilters || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "\(filteredStations.count)+"
        }
        return "\(radioBrowserTotalCount ?? filteredStations.count)"
    }

    private var activeFilterLabels: [String] {
        var labels: [String] = []
        if checkedOnly {
            labels.append(locale.text(.checked))
        }
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            labels.append(locale.text(.search))
        }
        if let selectedTag {
            labels.append(selectedTag == "news" ? locale.text(.news) : (findGenre(selectedTag)?.label ?? selectedTag))
        }
        if let selectedCountry {
            labels.append(selectedCountry.uppercased())
        }
        return labels
    }

    private var canLoadWorldwideStations: Bool {
        source == .all && !checkedOnly && radioBrowserHasMore
    }

    private func isCheckedStation(_ station: Station) -> Bool {
        station.status != nil
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
        let selectedCountry = selectedCountry
        let selectedTag = selectedTag
        let stations = stations
        filterTask?.cancel()
        filterTask = Task.detached(priority: .userInitiated) {
            let matches = stations.filter {
                stationMatches($0, query: query)
                    && stationMatchesFilters($0, country: selectedCountry, tag: selectedTag)
            }
            guard !Task.isCancelled else { return }
            await MainActor.run {
                filteredStations = matches
            }
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
              !checkedOnly else { return }
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
        let tag = findGenre(selectedTag)?.rbTag ?? selectedTag
        let country = selectedCountry
        let existingIDs = Set(stationPool.map(\.id))
        radioBrowserSearchTask = Task {
            do {
                let fetched = try await radioBrowser.search(
                    query: query.isEmpty ? nil : query,
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

    private func sourceButton(_ value: StationSource) -> some View {
        Button {
            dismissSearch()
            source = value
        } label: {
            Text(sourceTitle(value))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.2)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .foregroundStyle(source == value ? RrradioTheme.bg : RrradioTheme.ink3)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(source == value ? RrradioTheme.buttonFill : .clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func sourceTitle(_ value: StationSource) -> String {
        switch value {
        case .all: locale.text(.allStations)
        case .favorites: locale.text(.favorites)
        case .recents: locale.text(.recents)
        }
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
            .frame(width: 36, height: 36)
            .foregroundStyle(RrradioTheme.ink2)
            .overlay(Circle().stroke(RrradioTheme.line))
    }

    private func filterPickerRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
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
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
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

            if mode == .standard, hasStreamDetail {
                Button {
                    showingStreamQuality = true
                } label: {
                    qualityMeter
                        .frame(width: 26, height: 36, alignment: .center)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stream quality")
            }

            if showsFavoriteButton {
                Button(action: onToggleFavorite) {
                    Image(systemName: isFavorite ? "heart.fill" : "heart")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(isFavorite ? RrradioTheme.favoriteFill : RrradioTheme.ink4)
                        .frame(width: 36, height: 36)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isFavorite ? "Remove from favorites" : "Add to favorites")
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, mode == .favoritesExpanded ? 16 : 14)
        .alert("Stream quality", isPresented: $showingStreamQuality) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(streamQualityMessage)
        }
        .background {
            if isCurrent {
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
            Rectangle()
                .fill(RrradioTheme.line)
            .frame(width: UIScreen.main.bounds.width, height: 1)
        }
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
        if isCustom {
            LocalStationArtworkView(size: 38)
                .frame(width: 38, height: 38)
        } else {
            FaviconView(url: station.favicon, stationName: station.name, stationID: station.id, size: 38)
                .frame(width: 38, height: 38)
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
        if station.metadata != nil { return 3 }
        if station.status == "icy-only" { return 2 }
        if station.status != nil { return 1 }
        return 0
    }

    private var qualityMeter: some View {
        let level = streamQualityLevel(codec: station.codec, bitrate: station.bitrate)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(1...4, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1.2, style: .continuous)
                    .fill(index <= level ? RrradioTheme.ink3 : RrradioTheme.ink4.opacity(0.45))
                    .frame(width: 3, height: CGFloat(3 + index * 3))
            }
        }
        .frame(width: 18, height: 16, alignment: .bottom)
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
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .padding(3)
                    default:
                        Color.clear
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(RrradioTheme.line))
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
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    default:
                        initials
                    }
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
            .font(.system(size: 13, weight: .medium, design: .monospaced))
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

    func makeCoordinator() -> Coordinator {
        Coordinator(offset: $offset)
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
        DispatchQueue.main.async {
            context.coordinator.attach(to: view)
        }
    }

    final class Coordinator: NSObject {
        var offset: Binding<CGFloat>
        private weak var scrollView: UIScrollView?
        private var observation: NSKeyValueObservation?

        init(offset: Binding<CGFloat>) {
            self.offset = offset
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
            observation = scrollView.observe(\.contentOffset, options: [.initial, .new]) { [weak self] scrollView, _ in
                self?.offset.wrappedValue = max(0, scrollView.contentOffset.y + scrollView.adjustedContentInset.top)
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
