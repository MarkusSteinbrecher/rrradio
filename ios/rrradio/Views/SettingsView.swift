import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleController.self) private var locale
    @Environment(ThemeController.self) private var theme
    @State private var page: SettingsPage = .settings

    var body: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: locale.text(.settings)) { dismiss() }
            settingsTabs

            TabView(selection: $page) {
                SettingsPageView(page: $page)
                    .tag(SettingsPage.settings)
                AboutContentView()
                    .tag(SettingsPage.about)
                AddStationContentView {
                    dismiss()
                }
                .tag(SettingsPage.upload)
                ListeningHistoryPageView()
                    .tag(SettingsPage.listening)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
        .preferredColorScheme(theme.preferredColorScheme)
    }

    private var settingsTabs: some View {
        GeometryReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 18) {
                    ForEach(SettingsPage.allCases) { item in
                        Button {
                            withAnimation(.easeInOut(duration: 0.2)) {
                                page = item
                            }
                        } label: {
                            Text(item.title(locale))
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .textCase(.uppercase)
                                .tracking(1.4)
                                .foregroundStyle(page == item ? RrradioTheme.accent : RrradioTheme.ink3)
                                .padding(.vertical, 12)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
                .frame(minWidth: proxy.size.width, alignment: .center)
            }
        }
        .frame(height: 42)
        .frame(maxWidth: .infinity)
        .background(RrradioTheme.bg)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }
}

private struct SettingsPageView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(ThemeController.self) private var theme
    @Environment(LocaleController.self) private var locale
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(CarModeController.self) private var carMode
    @Environment(ListeningHistory.self) private var listeningHistory
    @AppStorage(LandingPage.storageKey) private var landingPageRaw = LandingPage.browse.rawValue
    @AppStorage(LandingPage.stationIDKey) private var landingStationID = ""
    @AppStorage(WakeAlarm.defaultTimeKey) private var defaultWakeTime = WakeAlarm.fallbackDefaultTime
    @AppStorage(SleepTimer.defaultMinutesKey) private var defaultSleepMinutes = SleepTimer.fallbackDefaultMinutes
    @Binding var page: SettingsPage
    @State private var landingStationQuery = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(locale.text(.settings))
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(locale.text(.appPreferences))
                        .font(.system(size: 15))
                        .foregroundStyle(RrradioTheme.ink3)
                }

                settingsSection(locale.text(.theme)) {
                    VStack(spacing: 0) {
                        themeRow(locale.text(.system), detail: locale.text(.followIOSAppearance), choice: .system)
                        themeRow(locale.text(.light), detail: locale.text(.alwaysLight), choice: .light)
                        themeRow(locale.text(.dark), detail: locale.text(.alwaysDark), choice: .dark)
                    }
                    .background(RrradioTheme.bg2)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                settingsSection(locale.text(.landingPage)) {
                    VStack(spacing: 0) {
                        landingPageRow(.browse)
                        landingPageRow(.favorites)
                        landingPageRow(.station)
                        if currentLandingPage == .station {
                            landingStationPicker
                        }
                    }
                    .background(RrradioTheme.bg2)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                settingsSection(locale.text(.timerDefaults)) {
                    VStack(spacing: 0) {
                        wakeDefaultRow
                        sleepDefaultRow
                    }
                    .background(RrradioTheme.bg2)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                settingsSection(locale.text(.carMode)) {
                    VStack(spacing: 0) {
                        carModeToggle(
                            icon: "car.fill",
                            title: locale.text(.automaticCarMode),
                            detail: "\(locale.text(.currentAudioRoute)): \(carMode.routeLabel)",
                            isOn: Binding(
                                get: { carMode.automaticEnabled },
                                set: { carMode.setAutomaticEnabled($0) },
                            ),
                        )
                        carModeToggle(
                            icon: "steeringwheel",
                            title: locale.text(.manualCarMode),
                            detail: carMode.isActive ? locale.text(.carModeActive) : locale.text(.carModeInactive),
                            isOn: Binding(
                                get: { carMode.manualEnabled },
                                set: { carMode.setManualEnabled($0) },
                            ),
                        )
                    }
                    .background(RrradioTheme.bg2)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                settingsSection("Listening History") {
                    VStack(spacing: 0) {
                        listeningHistoryToggle
                        if listeningHistory.isEnabled {
                            listeningHistoryDashboardLink
                            listeningHistoryLevelRows
                            listeningHistoryRetentionRows
                        }
                    }
                    .background(RrradioTheme.bg2)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                settingsSection(locale.text(.language)) {
                    VStack(spacing: 0) {
                        ForEach(LocaleController.Choice.allCases) { choice in
                            languageRow(choice)
                        }
                    }
                    .background(RrradioTheme.bg2)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
    }

    private func carModeToggle(icon: String, title: String, detail: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(2)
                }
            }
            .padding(.vertical, 10)
        }
        .tint(RrradioTheme.accent)
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private var listeningHistoryToggle: some View {
        Toggle(isOn: Binding(
            get: { listeningHistory.isEnabled },
            set: { listeningHistory.isEnabled = $0 },
        )) {
            HStack(spacing: 12) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Store listening history")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text("Off by default. Stored only on this device and never sent to rrradio.org.")
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(3)
                }
            }
            .padding(.vertical, 10)
        }
        .tint(RrradioTheme.accent)
        .padding(.horizontal, 14)
        .frame(minHeight: 66)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private var listeningHistoryDashboardLink: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                page = .listening
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.accent)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Open Listening dashboard")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text("Review your local listening stats.")
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
    }

    private var listeningHistoryLevelRows: some View {
        VStack(spacing: 0) {
            historyChoiceRow(
                icon: "dot.radiowaves.left.and.right",
                title: "Stations only",
                detail: "Station, country, start time, and listening duration.",
                selected: listeningHistory.level == .stations,
            ) {
                listeningHistory.level = .stations
            }
            historyChoiceRow(
                icon: "music.note",
                title: "Stations + tracks",
                detail: "Also stores artist and title when a station publishes them.",
                selected: listeningHistory.level == .tracks,
            ) {
                listeningHistory.level = .tracks
            }
        }
    }

    private var listeningHistoryRetentionRows: some View {
        VStack(spacing: 0) {
            ForEach(ListeningHistoryRetention.allCases) { retention in
                historyChoiceRow(
                    icon: "calendar",
                    title: retentionTitle(retention),
                    detail: "Keep local history for \(retentionDetail(retention)).",
                    selected: listeningHistory.retention == retention,
                ) {
                    listeningHistory.retention = retention
                }
            }
        }
    }

    private func historyChoiceRow(
        icon: String,
        title: String,
        detail: String,
        selected: Bool,
        action: @escaping () -> Void,
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(2)
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
    }

    private func retentionTitle(_ retention: ListeningHistoryRetention) -> String {
        switch retention {
        case .days30: "30 days"
        case .days90: "90 days"
        case .year1: "1 year"
        case .forever: "Forever"
        }
    }

    private func retentionDetail(_ retention: ListeningHistoryRetention) -> String {
        switch retention {
        case .days30: "30 days"
        case .days90: "90 days"
        case .year1: "1 year"
        case .forever: "as long as you keep it"
        }
    }

    private var wakeDefaultRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "alarm")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(locale.text(.defaultWake))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                Text(defaultWakeTime)
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            Spacer()
            DatePicker(
                "",
                selection: Binding(
                    get: { dateFromTime(defaultWakeTime) ?? dateFromTime(WakeAlarm.fallbackDefaultTime) ?? Date() },
                    set: { date in
                        let value = timeString(from: date)
                        defaultWakeTime = value
                        wakeAlarm.setDefaultTime(value)
                    },
                ),
                displayedComponents: .hourAndMinute,
            )
            .labelsHidden()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 54)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private var sleepDefaultRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(locale.text(.defaultSleep))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                Text(SleepTimer.format(defaultSleepMinutes))
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            Spacer()
            Picker("", selection: Binding(
                get: { defaultSleepMinutes },
                set: { minutes in
                    defaultSleepMinutes = minutes
                    sleepTimer.setDefaultMinutes(minutes)
                },
            )) {
                ForEach(SleepTimer.cycleMinutes.filter { $0 > 0 }, id: \.self) { minutes in
                    Text(SleepTimer.format(minutes)).tag(minutes)
                }
            }
            .labelsHidden()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 54)
    }

    private func settingsSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.4)
                .foregroundStyle(RrradioTheme.ink3)
            content()
        }
    }

    private func themeRow(_ title: String, detail: String, choice: ThemeController.Choice) -> some View {
        Button {
            theme.setChoice(choice)
        } label: {
            if let previewScheme = themePreviewScheme(for: choice) {
                themeRowContent(title, detail: detail, choice: choice, previewed: true)
                    .environment(\.colorScheme, previewScheme)
            } else {
                themeRowContent(title, detail: detail, choice: choice, previewed: false)
            }
        }
        .buttonStyle(.plain)
    }

    private func themeRowContent(
        _ title: String,
        detail: String,
        choice: ThemeController.Choice,
        previewed: Bool,
    ) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(previewed ? RrradioTheme.accent : RrradioTheme.ink)
                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            Spacer()
            if theme.choice == choice {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(RrradioTheme.accent)
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 54)
        .background(previewed ? RrradioTheme.bg : .clear)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func themePreviewScheme(for choice: ThemeController.Choice) -> ColorScheme? {
        switch choice {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    private func landingPageRow(_ landingPage: LandingPage) -> some View {
        Button {
            landingPageRaw = landingPage.rawValue
            if landingPage == .station, landingStationID.isEmpty, let station = player.current ?? landingStationOptions.first {
                landingStationID = station.id
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: landingPage.icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(landingPageTitle(landingPage))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(landingPageDetail(landingPage))
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(2)
                }
                Spacer()
                if currentLandingPage == landingPage {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 54)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
    }

    private var landingStationPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let current = player.current {
                Button {
                    landingStationID = current.id
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "dot.radiowaves.left.and.right")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(RrradioTheme.accent)
                            .frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(locale.text(.useCurrentStation))
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .textCase(.uppercase)
                                .tracking(1.1)
                                .foregroundStyle(RrradioTheme.ink3)
                            Text(current.name)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(RrradioTheme.ink)
                                .lineLimit(1)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(selectedLandingStationName)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                searchLandingStationField
            }

            VStack(spacing: 0) {
                ForEach(landingStationOptions.prefix(8)) { station in
                    landingStationRow(station)
                }
            }
        }
        .padding(14)
    }

    private var searchLandingStationField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
            TextField(locale.text(.searchStation), text: $landingStationQuery)
                .font(.system(size: 14))
                .foregroundStyle(RrradioTheme.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if !landingStationQuery.isEmpty {
                Button {
                    landingStationQuery = ""
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink3)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(RrradioTheme.bg)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func landingStationRow(_ station: Station) -> some View {
        Button {
            landingStationID = station.id
            landingPageRaw = LandingPage.station.rawValue
        } label: {
            HStack(spacing: 10) {
                Text(countryFlagEmoji(station.country))
                    .font(.system(size: 16))
                    .frame(width: 22)
                Text(station.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                Spacer()
                if landingStationID == station.id {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
            }
            .frame(minHeight: 38)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var currentLandingPage: LandingPage {
        LandingPage(rawValue: landingPageRaw) ?? .browse
    }

    private var selectedLandingStationName: String {
        guard let station = selectedLandingStation else {
            return locale.text(.chooseStation)
        }
        return "\(locale.text(.selectedStation)): \(station.name)"
    }

    private var selectedLandingStation: Station? {
        allLandingStations.first { $0.id == landingStationID }
    }

    private var landingStationOptions: [Station] {
        let query = landingStationQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let pool = query.isEmpty ? preferredLandingStations : allLandingStations
        guard !query.isEmpty else { return pool }
        return pool.filter { stationMatches($0, query: query) }
    }

    private var preferredLandingStations: [Station] {
        uniqueStations([player.current].compactMap { $0 } + library.favorites + library.recents + library.customStations + catalog.browseOrdered)
    }

    private var allLandingStations: [Station] {
        uniqueStations(library.customStations + library.favorites + library.recents + catalog.browseOrdered)
    }

    private func uniqueStations(_ stations: [Station]) -> [Station] {
        var seen = Set<String>()
        return stations.filter { station in
            seen.insert(station.id).inserted
        }
    }

    private func landingPageTitle(_ landingPage: LandingPage) -> String {
        switch landingPage {
        case .browse: locale.text(.browse)
        case .favorites: locale.text(.favorites)
        case .station: locale.text(.playStation)
        }
    }

    private func landingPageDetail(_ landingPage: LandingPage) -> String {
        switch landingPage {
        case .browse: locale.text(.landingBrowseDetail)
        case .favorites: locale.text(.landingFavoritesDetail)
        case .station: locale.text(.landingStationDetail)
        }
    }

    private func languageRow(_ choice: LocaleController.Choice) -> some View {
        Button {
            locale.setChoice(choice)
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(choice.displayName)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(choice.detail)
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                }
                Spacer()
                if locale.choice == choice {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(RrradioTheme.accent)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 54)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
        }
        .buttonStyle(.plain)
    }

    private func dateFromTime(_ value: String) -> Date? {
        let parts = value.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else { return nil }
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = hour
        components.minute = minute
        return Calendar.current.date(from: components)
    }

    private func timeString(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 7, components.minute ?? 0)
    }
}

private enum SettingsPage: Int, CaseIterable, Identifiable {
    case settings
    case about
    case upload
    case listening

    var id: Int { rawValue }

    func title(_ locale: LocaleController) -> String {
        switch self {
        case .settings: "Preferences"
        case .about: locale.text(.about)
        case .upload: locale.text(.upload)
        case .listening: "History"
        }
    }
}
