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

    private static func adaptive(light: UIColor, dark: UIColor) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

struct StationListView: View {
    @Binding private var tab: AppTab
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(ThemeController.self) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @State private var query = ""
    @State private var source: StationSource = .all
    @State private var librarySource: StationSource = .favorites
    @State private var showingAddStation = false
    @State private var showingFilters = false
    @State private var showingAbout = false
    @State private var showingMap = false
    @State private var showingNowPlaying = false
    @State private var selectedCountry: String?
    @State private var selectedTag: String?

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
    private var countries: [String] { availableCountries(from: allStations) }
    private var genres: [String] { availableCuratedGenres(from: allStations) }

    private var stations: [Station] {
        switch source {
        case .all: allStations
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
        let hasQuery = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return source == .all && !hasQuery && !hasActiveFilters ? 220 : filtered.count
    }

    private var visibleStations: [Station] { Array(filtered.prefix(displayLimit)) }
    private var hasActiveFilters: Bool { selectedCountry != nil || selectedTag != nil }

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
        .sheet(isPresented: $showingAddStation) {
            AddStationView()
        }
        .sheet(isPresented: $showingFilters) {
            StationFilterView(
                stations: allStations,
                selectedCountry: $selectedCountry,
                selectedTag: $selectedTag,
            )
        }
        .sheet(isPresented: $showingAbout) {
            AboutView()
        }
        .sheet(isPresented: $showingMap) {
            StationMapView(
                stations: allStations,
                selectedCountry: $selectedCountry,
            )
        }
        .sheet(isPresented: $showingNowPlaying) {
            NowPlayingView()
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
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
            if value == .all {
                tab = .browse
            } else {
                librarySource = value
                tab = .library
            }
        }
    }

    private var topbar: some View {
        VStack(spacing: 14) {
            HStack(alignment: .center) {
                Button {
                    query = ""
                    source = .all
                    selectedCountry = nil
                    selectedTag = nil
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
                .accessibilityLabel("Go to home")

                Spacer()

                HStack(spacing: 8) {
                    circularIconButton(themeIcon, label: "Switch theme") {
                        theme.toggle(effective: colorScheme)
                    }
                    circularIconButton("info", label: "About rrradio") {
                        showingAbout = true
                    }
                    circularIconButton("plus", label: "Add custom station") {
                        showingAddStation = true
                    }
                }
            }

            searchField
            if tab == .browse {
                filterRow
            } else {
                librarySegments
            }
            sectionStatus
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
                .accessibilityLabel("Clear search")
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
                    filterCell("Curated") {
                        circularFilterButton(
                            icon: "star.fill",
                            active: source == .all && !hasActiveFilters,
                        ) {
                            source = .all
                            selectedCountry = nil
                            selectedTag = nil
                        }
                    }
                    filterCell("Played") {
                        circularFilterButton(icon: "chart.bar.fill", active: source == .recents) {
                            source = .recents
                        }
                    }
                    filterCell("News") {
                        circularFilterButton(icon: "newspaper", active: selectedTag == "news") {
                            source = .all
                            selectedTag = selectedTag == "news" ? nil : "news"
                        }
                    }
                    filterCell("Genre") {
                        Menu {
                            Button("All genres") { selectedTag = nil }
                            ForEach(genres, id: \.self) { tag in
                                Button(tag) { selectedTag = tag }
                            }
                        } label: {
                            circularFilterLabel(icon: "music.note", active: selectedTag != nil && selectedTag != "news")
                        }
                    }
                    filterCell("Country") {
                        Menu {
                            Button("All countries") { selectedCountry = nil }
                            ForEach(countries, id: \.self) { code in
                                Button("\(countryDisplayName(code)) (\(code))") { selectedCountry = code }
                            }
                        } label: {
                            circularFilterLabel(icon: "flag", active: selectedCountry != nil)
                        }
                    }
                    filterCell("Map") {
                        circularFilterButton(icon: "map", active: selectedCountry != nil) {
                            source = .all
                            showingMap = true
                        }
                    }
                }
                .padding(.horizontal, 1)
                .frame(minWidth: proxy.size.width, alignment: .center)
            }
        }
        .frame(height: 52)
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
            LazyVStack(spacing: 0) {
                ForEach(visibleStations) { station in
                    StationRow(
                        station: station,
                        isCurrent: player.current?.id == station.id,
                        isPlaying: player.current?.id == station.id && player.state == .playing,
                        isFavorite: library.isFavorite(station),
                        isCustom: library.isCustom(station),
                        onPlay: {
                            player.play(station)
                            library.pushRecent(station)
                            showingNowPlaying = true
                        },
                        onToggleFavorite: {
                            library.toggleFavorite(station)
                        },
                    )
                }
                if visibleStations.count < filtered.count {
                    Text("Showing \(visibleStations.count) of \(filtered.count). Search or filter to narrow the catalog.")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(1.2)
                        .foregroundStyle(RrradioTheme.ink3)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 18)
                        .frame(maxWidth: .infinity)
                        .overlay(alignment: .top) {
                            Rectangle()
                                .fill(RrradioTheme.line)
                                .frame(height: 1)
                        }
                }
            }
            .padding(.bottom, 12)
        }
        .background(RrradioTheme.bg)
    }

    private var emptyTitle: String {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty || hasActiveFilters {
            return "No stations found"
        }
        switch source {
        case .all: return "Catalog empty"
        case .favorites: return "No favorites yet"
        case .recents: return "No recents yet"
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
            return "Try a station name, country code, or tag."
        }
        switch source {
        case .all: return "The catalog has not loaded any rows."
        case .favorites: return "Tap the heart in Now Playing to save a station."
        case .recents: return "Stations appear here after you play them."
        }
    }

    private var statusLabel: String {
        switch source {
        case .all:
            if hasActiveFilters || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return "Filtered"
            }
            return "Curated + worldwide"
        case .favorites: return "Favorites"
        case .recents: return "Recents"
        }
    }

    private var searchPlaceholder: String {
        switch source {
        case .all: return "Search stations, genres, places..."
        case .favorites: return "Search your favorites..."
        case .recents: return "Search recently played..."
        }
    }

    private var themeIcon: String {
        colorScheme == .dark ? "moon" : "sun.max"
    }

    private func sourceButton(_ value: StationSource) -> some View {
        Button {
            source = value
        } label: {
            Text(value.rawValue)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.2)
                .foregroundStyle(source == value ? RrradioTheme.bg : RrradioTheme.ink3)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(source == value ? RrradioTheme.ink : .clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func circularIconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .frame(width: 28, height: 28)
                .foregroundStyle(RrradioTheme.ink2)
                .overlay(Circle().stroke(RrradioTheme.line))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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
            .background(active ? RrradioTheme.ink : .clear)
            .overlay(Circle().stroke(active ? RrradioTheme.ink : RrradioTheme.line))
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
                            if let cc = station.country {
                                Text(cc.uppercased())
                                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                    .foregroundStyle(RrradioTheme.ink3)
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
                    .foregroundStyle(isFavorite ? RrradioTheme.ink : RrradioTheme.ink3)
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
            Rectangle()
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
        .clipShape(RoundedRectangle(cornerRadius: 2))
        .overlay(RoundedRectangle(cornerRadius: 2).stroke(RrradioTheme.line))
    }

    private var initials: some View {
        Text(stationInitials(stationName))
            .font(.system(size: 13, weight: .medium, design: .monospaced))
            .foregroundStyle(faviconPalette.foreground)
    }

    private var faviconPalette: (background: Color, foreground: Color) {
        let first = stationID.unicodeScalars.first?.value ?? 0
        let last = stationID.unicodeScalars.last?.value ?? 0
        switch Int(first + last) % 4 {
        case 1: return (RrradioTheme.ink, RrradioTheme.bg)
        case 2: return (RrradioTheme.bg3, RrradioTheme.ink2)
        case 3: return (RrradioTheme.bg3, RrradioTheme.accent)
        default: return (RrradioTheme.bg2, RrradioTheme.ink2)
        }
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
