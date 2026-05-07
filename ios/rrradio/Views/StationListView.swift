import SwiftUI
import UIKit

enum RrradioTheme {
    static let accent = adaptive(
        light: UIColor(red: 0, green: 0.627, blue: 0.251, alpha: 1),
        dark: UIColor(red: 1, green: 1, blue: 0, alpha: 1),
    )
    static let bg = adaptive(
        light: UIColor(red: 0.973, green: 0.973, blue: 0.953, alpha: 1),
        dark: UIColor(red: 0.039, green: 0.039, blue: 0.039, alpha: 1),
    )
    static let bg2 = adaptive(
        light: UIColor(red: 1, green: 1, blue: 0.984, alpha: 1),
        dark: UIColor(red: 0.075, green: 0.075, blue: 0.075, alpha: 1),
    )
    static let bg3 = adaptive(
        light: UIColor(red: 0.925, green: 0.925, blue: 0.895, alpha: 1),
        dark: UIColor(red: 0.102, green: 0.102, blue: 0.102, alpha: 1),
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
        light: UIColor(red: 0.165, green: 0.165, blue: 0.150, alpha: 1),
        dark: UIColor(red: 0.957, green: 0.957, blue: 0.949, alpha: 1),
    )

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

enum StationViewLayout: String, CaseIterable, Identifiable {
    case list
    case tiles

    static let storageKey = "rrradio.stationLayout"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .list: "list.bullet"
        case .tiles: "square.grid.2x2"
        }
    }
}

struct StationListView: View {
    @Binding private var tab: AppTab
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(ThemeController.self) private var theme
    @Environment(LocaleController.self) private var locale
    @Environment(\.colorScheme) private var colorScheme
    private let radioBrowser = RadioBrowserClient()
    private let shareURL = URL(string: "https://rrradio.org")!
    @State private var query = ""
    @State private var source: StationSource = .all
    @State private var librarySource: StationSource = .favorites
    @State private var showingSettings = false
    @State private var showingMap = false
    @State private var showingNowPlaying = false
    @State private var timerCancelConfirmation: TimerCancelTarget?
    @State private var checkedOnly = true
    @State private var selectedCountry: String?
    @State private var selectedTag: String?
    @State private var activeFilterPicker: ActiveFilterPicker?
    @AppStorage(StationViewLayout.storageKey) private var stationLayoutRaw = StationViewLayout.list.rawValue
    @State private var stationDisplayLimit = 220
    @State private var radioBrowserStations: [Station] = []
    @State private var radioBrowserOffset = 0
    @State private var radioBrowserHasMore = true
    @State private var radioBrowserLoading = false
    @FocusState private var searchFocused: Bool

    private let stationPageSize = 220

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

    init(tab: Binding<AppTab> = .constant(.browse)) {
        _tab = tab
    }

    private var allStations: [Station] { library.customStations + catalog.browseOrdered }
    private var stationPool: [Station] {
        checkedOnly ? allStations : allStations + radioBrowserStations
    }
    private var countries: [String] { availableCountries(from: allStations) }
    private var genres: [String] { availableGenres(from: allStations) }

    private var stations: [Station] {
        switch source {
        case .all:
            checkedOnly ? allStations.filter(isCheckedStation) : stationPool
        case .favorites: library.favorites
        case .recents: library.recents
        }
    }

    private var filtered: [Station] {
        stations.filter {
            stationMatches($0, query: query)
                && stationMatchesFilters($0, country: selectedCountry, tag: selectedTag)
        }
    }

    private var displayLimit: Int {
        min(stationDisplayLimit, filtered.count)
    }

    private var visibleStations: [Station] { Array(filtered.prefix(displayLimit)) }
    private var hasActiveFilters: Bool { selectedCountry != nil || selectedTag != nil }
    private var stationLayout: StationViewLayout {
        StationViewLayout(rawValue: stationLayoutRaw) ?? .list
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
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(locale.text(.done)) {
                    searchFocused = false
                }
            }
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
        }
        .onChange(of: selectedCountry) { _, _ in
            resetStationDisplayLimit()
            resetRadioBrowserStations()
        }
        .onChange(of: selectedTag) { _, _ in
            resetStationDisplayLimit()
            resetRadioBrowserStations()
        }
        .onChange(of: checkedOnly) { _, _ in
            resetStationDisplayLimit()
            resetRadioBrowserStations()
        }
    }

    private var topbar: some View {
        VStack(spacing: 14) {
            HStack(alignment: .center) {
                Button {
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
                    ShareLink(item: shareURL) {
                        circularIconLabel("square.and.arrow.up")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(locale.text(.share))

                    circularIconButton("gearshape", label: locale.text(.settings)) {
                        showingSettings = true
                    }
                }
            }

            searchField
            if tab == .browse {
                filterRow
            } else {
                librarySegments
            }
            statusToolbar
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background(RrradioTheme.bg)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
            TextField(searchPlaceholder, text: $query)
                .font(.system(size: 16))
                .foregroundStyle(RrradioTheme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit {
                    searchFocused = false
                }
                .onChange(of: searchFocused) { _, focused in
                    if focused {
                        activeFilterPicker = nil
                    }
                }
            if !query.isEmpty {
                Button {
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
                            checkedOnly.toggle()
                            activeFilterPicker = nil
                        }
                    }
                    filterCell(locale.text(.news)) {
                        circularFilterButton(icon: "newspaper", active: selectedTag == "news") {
                            source = .all
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
                            activeFilterPicker = activeFilterPicker == .genre ? nil : .genre
                        }
                    }
                    filterCell(locale.text(.country)) {
                        circularFilterButton(
                            icon: "flag",
                            active: activeFilterPicker == .country || selectedCountry != nil,
                        ) {
                            source = .all
                            activeFilterPicker = activeFilterPicker == .country ? nil : .country
                        }
                    }
                    filterCell(locale.text(.map)) {
                        circularFilterButton(icon: "map", active: false) {
                            source = .all
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
                            ForEach(genres, id: \.self) { tag in
                                filterPickerRow(tag, selected: selectedTag == tag) {
                                    selectedTag = tag
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
            Text("\(filtered.count)")
                .foregroundStyle(RrradioTheme.ink4)
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .textCase(.uppercase)
        .tracking(1.5)
        .foregroundStyle(RrradioTheme.ink3)
        .frame(maxWidth: .infinity)
    }

    private var statusToolbar: some View {
        ZStack {
            sectionStatus
            HStack {
                layoutToggle
                Spacer()
            }
        }
    }

    private var layoutToggle: some View {
        HStack(spacing: 6) {
            layoutButton(.list, label: "List view")
            layoutButton(.tiles, label: "Tile view")
        }
        .padding(3)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
    }

    private func layoutButton(_ layout: StationViewLayout, label: String) -> some View {
        Button {
            stationLayoutRaw = layout.rawValue
        } label: {
            Image(systemName: layout.icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(stationLayout == layout ? RrradioTheme.bg : RrradioTheme.ink3)
                .frame(width: 34, height: 28)
                .background(stationLayout == layout ? RrradioTheme.buttonFill : .clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var content: some View {
        if filtered.isEmpty {
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

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                Section {
                    switch stationLayout {
                    case .list:
                        ForEach(visibleStations) { station in
                            StationRow(
                                station: station,
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
                            )
                        }
                    case .tiles:
                        LazyVGrid(columns: tileColumns, spacing: 0) {
                            ForEach(visibleStations) { station in
                                StationTile(
                                    station: station,
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
                                )
                            }
                        }
                        .padding(.top, 1)
                    }
                    if visibleStations.count < filtered.count || canLoadWorldwideStations {
                        loadMoreRow
                    }
                } header: {
                    timerStatusStrip
                }
            }
            .padding(.bottom, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable {
            await catalog.refresh()
        }
        .background(RrradioTheme.bg)
    }

    private var tileColumns: [GridItem] {
        [
            GridItem(.adaptive(minimum: 148, maximum: 190), spacing: 0, alignment: .top),
        ]
    }

    private func play(_ station: Station) {
        player.play(station)
        library.pushRecent(station)
        showingNowPlaying = true
    }

    private var loadMoreRow: some View {
        VStack(spacing: 10) {
            Text("\(locale.text(.showing)) \(visibleStations.count) \(locale.text(.of)) \(filtered.count)")
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
        if wakeAlarm.isArmed || sleepTimer.isArmed {
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

    private func timerStatusRow(
        icon: String,
        title: String,
        detail: String,
        station: Station?,
        cancelTarget: TimerCancelTarget,
    ) -> some View {
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
                .frame(height: 2)
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.accent)
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
        .foregroundStyle(RrradioTheme.accent.opacity(0.85))
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

    private var activeFilterLabels: [String] {
        var labels: [String] = []
        if checkedOnly {
            labels.append(locale.text(.checked))
        }
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            labels.append(locale.text(.search))
        }
        if let selectedTag {
            labels.append(selectedTag == "news" ? locale.text(.news) : selectedTag)
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
        radioBrowserStations = []
        radioBrowserOffset = 0
        radioBrowserHasMore = true
        radioBrowserLoading = false
    }

    private func loadMoreStations() {
        if visibleStations.count < filtered.count {
            stationDisplayLimit = min(stationDisplayLimit + stationPageSize, filtered.count)
            return
        }
        guard canLoadWorldwideStations, !radioBrowserLoading else { return }
        radioBrowserLoading = true
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let tag = selectedTag
        let country = selectedCountry
        let existingIDs = Set(stationPool.map(\.id))
        Task {
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
                stationDisplayLimit = min(stationDisplayLimit + max(fresh.count, stationPageSize), filtered.count)
            } catch {
                radioBrowserHasMore = false
            }
            radioBrowserLoading = false
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
            source = value
        } label: {
            Text(sourceTitle(value))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.2)
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
    let station: Station
    let isCurrent: Bool
    let isPlaying: Bool
    let isFavorite: Bool
    let isCustom: Bool
    let onPlay: () -> Void
    let onToggleFavorite: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(action: onPlay) {
                HStack(spacing: 14) {
                    FaviconView(url: station.favicon, stationName: station.name, stationID: station.id)
                        .frame(width: 38, height: 38)
	                    VStack(alignment: .leading, spacing: 3) {
	                        HStack(spacing: 4) {
	                            Text(station.name)
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
                        HStack(spacing: 5) {
                            capabilityStars
                            if let tags = station.tags, !tags.isEmpty {
                                Text(tags.prefix(3).joined(separator: " . "))
                                    .lineLimit(1)
                            }
                        }
                        .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink3)
                        .textCase(.lowercase)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if isPlaying {
                        EqualizerView()
                    }
                    if isCustom {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(RrradioTheme.ink3)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button(action: onToggleFavorite) {
                Image(systemName: isFavorite ? "heart.fill" : "heart")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(isFavorite ? RrradioTheme.ink : RrradioTheme.ink4)
                    .frame(width: 36, height: 36)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isFavorite ? "Remove from favorites" : "Add to favorites")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
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
                .frame(height: 1)
        }
        .contentShape(Rectangle())
    }

    private var capabilityStars: some View {
        HStack(spacing: 1) {
            ForEach(0..<starCount, id: \.self) { _ in
                Image(systemName: "star.fill")
                    .font(.system(size: 8))
            }
        }
        .foregroundStyle(RrradioTheme.accent.opacity(0.85))
    }

    private var starCount: Int {
        if station.metadata != nil { return 3 }
        if station.status == "icy-only" { return 2 }
        if station.status != nil { return 1 }
        return 0
    }
}

struct StationTile: View {
    let station: Station
    let isCurrent: Bool
    let isPlaying: Bool
    let isFavorite: Bool
    let isCustom: Bool
    let onPlay: () -> Void
    let onToggleFavorite: () -> Void

    var body: some View {
        Button(action: onPlay) {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .top) {
                    FaviconView(url: station.favicon, stationName: station.name, stationID: station.id)
                        .frame(width: 54, height: 54)
                    Spacer()
                    Button(action: onToggleFavorite) {
                        Image(systemName: isFavorite ? "heart.fill" : "heart")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(isFavorite ? RrradioTheme.ink : RrradioTheme.ink4)
                            .frame(width: 32, height: 32)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isFavorite ? "Remove from favorites" : "Add to favorites")
                }

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 5) {
                        Text(station.name)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(isCurrent ? RrradioTheme.accent : RrradioTheme.ink)
                            .lineLimit(2)
                            .minimumScaleFactor(0.78)
                        let flag = countryFlagEmoji(station.country)
                        if !flag.isEmpty {
                            Text(flag)
                                .font(.system(size: 12))
                                .foregroundStyle(.primary)
                        }
                    }

                    HStack(spacing: 5) {
                        capabilityStars
                        if let tags = station.tags, !tags.isEmpty {
                            Text(tags.prefix(2).joined(separator: " . "))
                                .lineLimit(1)
                        }
                    }
                    .font(.system(size: 10, weight: .regular, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .textCase(.lowercase)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
            .background {
                if isCurrent {
                    LinearGradient(
                        colors: [RrradioTheme.ink.opacity(0.035), .clear],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing,
                    )
                } else {
                    RrradioTheme.bg
                }
            }
            .overlay {
                Rectangle()
                    .stroke(isCurrent ? RrradioTheme.accent : RrradioTheme.line, lineWidth: isCurrent ? 2 : 1)
            }
            .overlay(alignment: .leading) {
                if isCurrent {
                    Rectangle()
                        .fill(RrradioTheme.accent)
                        .frame(width: 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var capabilityStars: some View {
        HStack(spacing: 1) {
            ForEach(0..<starCount, id: \.self) { _ in
                Image(systemName: "star.fill")
                    .font(.system(size: 8))
            }
        }
        .foregroundStyle(RrradioTheme.accent.opacity(0.85))
    }

    private var starCount: Int {
        if station.metadata != nil { return 3 }
        if station.status == "icy-only" { return 2 }
        if station.status != nil { return 1 }
        return 0
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

struct FaviconView: View {
    let url: URL?
    var stationName = ""
    var stationID = ""

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
        .frame(width: 38, height: 38)
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
