import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleController.self) private var locale
    @State private var page: SettingsPage = .settings

    var body: some View {
        content
    }

    private var content: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: locale.text(.settings)) { dismiss() }
            settingsTabs

            settingsPageContent
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    @ViewBuilder
    private var settingsPageContent: some View {
        switch page {
        case .settings:
            SettingsPageView(page: $page)
        case .about:
            AboutContentView()
        case .upload:
            AddStationContentView()
        case .listening:
            ListeningHistoryPageView()
        }
    }

    private var settingsTabs: some View {
        GeometryReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 18) {
                    ForEach(SettingsPage.allCases) { item in
                        Button {
                            page = item
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
    @Environment(\.openURL) private var openURL
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(ThemeController.self) private var theme
    @Environment(LocaleController.self) private var locale
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(CarModeController.self) private var carMode
    @Environment(ListeningHistory.self) private var listeningHistory
    @Environment(Diagnostics.self) private var diagnostics
    @Environment(CloudSyncController.self) private var cloudSync
    @AppStorage(LandingPage.storageKey) private var landingPageRaw = LandingPage.browse.rawValue
    @AppStorage(LandingPage.stationIDKey) private var landingStationID = ""
    @AppStorage(LandingPage.stationListIDKey) private var landingStationListID = ""
    @AppStorage(WakeAlarm.defaultTimeKey) private var defaultWakeTime = WakeAlarm.fallbackDefaultTime
    @AppStorage(SleepTimer.defaultMinutesKey) private var defaultSleepMinutes = SleepTimer.fallbackDefaultMinutes
    @AppStorage(FavoritesDisplayMode.storageKey) private var favoritesDisplayModeRaw = FavoritesDisplayMode.list.rawValue
    @AppStorage(FavoritesDisplayMode.orderStorageKey) private var favoritesDisplayModeOrderRaw = FavoritesDisplayMode.defaultRawValue
    @AppStorage(FavoritesDisplayMode.visibleStorageKey) private var favoritesDisplayModeVisibleRaw = FavoritesDisplayMode.defaultRawValue
    @Binding var page: SettingsPage
    @State private var landingStationQuery = ""
    @State private var copiedDiagnostics = false
    @State private var confirmCloudDelete = false
    @State private var isRefreshingCatalog = false
    @State private var showingAccentPicker = false
    @State private var accentPickerColor = UIColor.systemYellow
    @State private var accentPickerHexDraft = ThemeController.classicAccentHex
    @State private var accentPickerHexInvalid = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                    settingsSection(locale.text(.theme)) {
                        HStack(spacing: 4) {
                            themeRadioButton(locale.text(.system), choice: .system)
                            themeRadioButton(locale.text(.light), choice: .light)
                            themeRadioButton(locale.text(.dark), choice: .dark)
                        }
                        .padding(3)
                        .background(RrradioTheme.bg2)
                        .overlay(Capsule().stroke(RrradioTheme.line))
                        .clipShape(Capsule())
                    }

                    settingsSection("Color") {
                        accentColorSection
                    }

                    settingsSection("iCloud Sync") {
                        cloudSyncSection
                    }

                    settingsSection("Catalog") {
                        catalogSection
                    }

                    settingsSection(locale.text(.landingPage)) {
                        VStack(spacing: 0) {
                            landingPageRow(.browse)
                            landingPageRow(.library)
                            landingPageRow(.recents)
                            landingPageRow(.favorites)
                            ForEach(library.stationLists) { list in
                                landingStationListRow(list)
                            }
                            landingPageRow(.station)
                            if currentLandingPage == .station {
                                landingStationPicker
                            }
                        }
                        .background(RrradioTheme.bg2)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    settingsSection("Library views") {
                        VStack(spacing: 0) {
                            ForEach(Array(favoritesDisplayOrder.enumerated()), id: \.element) { index, mode in
                                favoritesDisplayModeConfigurationRow(mode, index: index)
                            }
                        }
                        .background(RrradioTheme.bg2)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    settingsSection("Default Library view") {
                        VStack(spacing: 0) {
                            ForEach(visibleFavoritesDisplayModes) { mode in
                                favoritesDisplayModeRow(mode)
                            }
                        }
                        .background(RrradioTheme.bg2)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    settingsSection(locale.text(.timerDefaults)) {
                        VStack(spacing: 0) {
                            wakeDefaultRow
                            wakeNotificationRow
                            wakeShortcutsRow
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

                    settingsSection("Diagnostics") {
                        diagnosticsSection
                    }
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
        .alert("Remove iCloud data?", isPresented: $confirmCloudDelete) {
            Button(locale.text(.cancel), role: .cancel) {}
            Button("Remove", role: .destructive) {
                Task { await cloudSync.removeAllCloudData() }
            }
        } message: {
            Text("This clears synced rrradio favorites, station lists, custom stations, and preferences from iCloud. iCloud-enabled devices will converge to an empty synced library.")
        }
        .sheet(isPresented: $showingAccentPicker) {
            AccentColorPickerSheet(
                color: $accentPickerColor,
                hexDraft: $accentPickerHexDraft,
                hexInvalid: $accentPickerHexInvalid,
                onAccept: acceptAccentPicker,
                onCancel: { showingAccentPicker = false },
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    private var cloudSyncSection: some View {
        VStack(spacing: 0) {
            Toggle(isOn: Binding(
                get: { cloudSync.isEnabled },
                set: { cloudSync.setEnabled($0) },
            )) {
                HStack(spacing: 12) {
                    Image(systemName: cloudSyncIcon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(cloudSync.availability == .available ? RrradioTheme.accent : RrradioTheme.ink3)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sync library and settings with iCloud")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                        Text(cloudSyncDetail)
                            .font(.system(size: 12))
                            .foregroundStyle(RrradioTheme.ink3)
                            .lineLimit(3)
                    }
                }
                .padding(.vertical, 10)
            }
            .disabled(cloudSyncToggleDisabled)
            .tint(RrradioTheme.accent)
            .padding(.horizontal, 14)
            .frame(minHeight: 68)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            HStack(spacing: 10) {
                diagnosticsButton(cloudSync.isSyncing ? "Syncing" : "Sync now", systemImage: "arrow.triangle.2.circlepath") {
                    Task { await cloudSync.refreshFromCloud() }
                }
                .disabled(cloudSync.isSyncing || !cloudSync.isEnabled)

                diagnosticsButton("iPhone Settings", systemImage: "gear") {
                    cloudSync.openICloudSettings()
                }
            }
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .padding(14)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            Button(role: .destructive) {
                confirmCloudDelete = true
            } label: {
                Label("Remove all rrradio data from iCloud", systemImage: "trash")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
            }
            .buttonStyle(.plain)
            .foregroundStyle(RrradioTheme.favoriteFill)
            .disabled(!cloudSync.isEnabled || cloudSync.isSyncing)
        }
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var catalogSection: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Station catalog")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(catalogDetail)
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(3)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: 68)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            HStack(spacing: 10) {
                diagnosticsButton(isRefreshingCatalog ? "Refreshing" : "Refresh", systemImage: "arrow.clockwise") {
                    refreshCatalogFromSettings()
                }
                .disabled(isRefreshingCatalog)
            }
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .padding(14)
        }
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var catalogDetail: String {
        if isRefreshingCatalog {
            return "Refreshing station list..."
        }

        switch catalog.state {
        case .idle:
            return "Loaded on app start and checked occasionally when the app becomes active."
        case .loading:
            return "Loading station list..."
        case .loaded:
            return "\(catalog.stations.count) stations loaded. The app checks for updates occasionally."
        case let .failed(message):
            return "Could not refresh: \(message)"
        }
    }

    private func refreshCatalogFromSettings() {
        guard !isRefreshingCatalog else { return }
        isRefreshingCatalog = true
        Task { @MainActor in
            await catalog.refresh()
            isRefreshingCatalog = false
        }
    }

    private var cloudSyncIcon: String {
        if !cloudSync.isEnabled { return "icloud.slash" }
        return cloudSync.availability == .available ? "icloud.fill" : "icloud"
    }

    private var cloudSyncToggleDisabled: Bool {
        cloudSync.isEnabled && cloudSync.availability != .available
    }

    private var cloudSyncDetail: String {
        if !cloudSync.isEnabled {
            return "Off for this device. Existing iCloud data is kept for other devices."
        }
        switch cloudSync.diagnosticState {
        case .checking:
            return "Checking iCloud availability and restore data..."
        case let .unavailable(message):
            return message
        case .emptyRemote:
            return "iCloud is available, but no rrradio favorites, station lists, custom stations, or preferences are stored yet."
        case let .restored(summary):
            return "Restored \(cloudSyncSummary(summary)) from iCloud.\(cloudSyncLastSyncSuffix)"
        case let .synced(summary):
            return "Synced \(cloudSyncSummary(summary)) with iCloud.\(cloudSyncLastSyncSuffix)"
        case let .pushed(summary):
            return "Uploaded \(cloudSyncSummary(summary)) to iCloud.\(cloudSyncLastSyncSuffix)"
        case .resetApplied:
            return "Applied a cloud reset. Local synced favorites, station lists, custom stations, and preferences were cleared."
        case .removedCloudData:
            return "Removed rrradio favorites, station lists, custom stations, and preferences from iCloud."
        case let .failed(message):
            return message
        case .idle:
            break
        }
        switch cloudSync.availability {
        case .checking:
            return "Checking iCloud availability..."
        case .available:
            if let lastSync = cloudSync.lastSync {
                return "Favorites, station lists, custom stations, and preferences sync privately through iCloud. Last sync: \(lastSync.formatted(date: .omitted, time: .shortened))."
            }
            return "Favorites, station lists, custom stations, and preferences sync privately through iCloud."
        case let .unavailable(message):
            return message
        }
    }

    private var cloudSyncLastSyncSuffix: String {
        guard let lastSync = cloudSync.lastSync else { return "" }
        return " Last sync: \(lastSync.formatted(date: .omitted, time: .shortened))."
    }

    private func cloudSyncSummary(_ summary: CloudSyncController.SnapshotSummary) -> String {
        let preferences = summary.hasPreferences ? "preferences" : "no preferences"
        return "\(summary.favorites) \(summary.favorites == 1 ? "favorite" : "favorites"), \(summary.stationLists) \(summary.stationLists == 1 ? "list" : "lists"), \(summary.customStations) custom \(summary.customStations == 1 ? "station" : "stations"), and \(preferences)"
    }

    private var diagnosticsSection: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Toggle(isOn: Binding(
                    get: { diagnostics.isEnabled },
                    set: { diagnostics.isEnabled = $0 },
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Collect Diagnostics")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                        Text("Off by default. Stores a local troubleshooting log on this device; shared copies redact station and host details.")
                            .font(.system(size: 12))
                            .foregroundStyle(RrradioTheme.ink3)
                            .lineLimit(4)
                    }
                }
                .tint(RrradioTheme.accent)

                Text(diagnostics.recentSummary)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .lineLimit(8)
                    .textSelection(.enabled)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RrradioTheme.bg)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(RrradioTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .padding(14)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            HStack(spacing: 10) {
                diagnosticsButton(copiedDiagnostics ? "Copied" : "Copy", systemImage: "doc.on.doc") {
                    UIPasteboard.general.string = diagnostics.exportText()
                    copiedDiagnostics = true
                    diagnostics.record("diagnostics", "copied")
                }
                .disabled(!diagnostics.isEnabled || diagnostics.events.isEmpty)

                ShareLink(item: diagnostics.exportText()) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(RrradioTheme.accent)
                .disabled(!diagnostics.isEnabled || diagnostics.events.isEmpty)
                .simultaneousGesture(TapGesture().onEnded {
                    diagnostics.record("diagnostics", "share opened")
                })

                diagnosticsButton("Clear", systemImage: "trash") {
                    diagnostics.clear()
                    copiedDiagnostics = false
                }
                .disabled(diagnostics.events.isEmpty)
            }
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .padding(14)
        }
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func diagnosticsButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(RrradioTheme.accent)
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
            page = .listening
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

    private var wakeNotificationRow: some View {
        Toggle(isOn: Binding(
            get: { wakeAlarm.notificationsEnabled },
            set: { wakeAlarm.setNotificationsEnabled($0) },
        )) {
            HStack(spacing: 12) {
                Image(systemName: wakeAlarm.notificationsEnabled ? "bell.fill" : "bell.slash")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(wakeAlarm.notificationsEnabled ? RrradioTheme.accent : RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(locale.text(.wakeNotification))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(locale.text(.wakeNotificationDetail))
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

    private var wakeShortcutsRow: some View {
        Button {
            openShortcutsSetup()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.accent)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(locale.text(.setupScheduledPlay))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(locale.text(.setupScheduledPlayDetail))
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(3)
                }
                Spacer()
                Image(systemName: "arrow.up.forward.app")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(minHeight: 66)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func openShortcutsSetup() {
        let encodedName = "rrradio%20Scheduled%20Play"
        let encodedAction = "Play%20Last%20Station"
        guard let url = URL(string: "shortcuts://create-shortcut?name=\(encodedName)&actions=\(encodedAction)") else { return }
        openURL(url)
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

    private func themeRadioButton(_ title: String, choice: ThemeController.Choice) -> some View {
        let selected = theme.choice == choice
        return Button {
            theme.setChoice(choice)
        } label: {
            HStack(spacing: 7) {
                Image(systemName: themeRadioIcon(for: choice))
                    .font(.system(size: 12, weight: selected ? .semibold : .medium))
                Text(title)
                    .font(.system(size: 13, weight: selected ? .semibold : .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundStyle(selected ? RrradioTheme.bg : RrradioTheme.ink3)
            .frame(maxWidth: .infinity, minHeight: 34)
            .background(selected ? RrradioTheme.buttonFill : .clear)
            .clipShape(Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func themeRadioIcon(for choice: ThemeController.Choice) -> String {
        switch choice {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max"
        case .dark: return "moon"
        }
    }

    private var accentColorSection: some View {
        VStack(spacing: 0) {
            Button {
                accentPickerColor = UIColor(theme.accentColor)
                syncAccentPickerHexDraft(from: accentPickerColor)
                showingAccentPicker = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "paintpalette")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink3)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Accent")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                        Text(theme.hasCustomAccent ? theme.accentHexValue : "Classic rrradio color")
                            .font(.system(size: 12))
                            .foregroundStyle(RrradioTheme.ink3)
                    }
                    Spacer()
                    Circle()
                        .fill(theme.accentColor)
                        .frame(width: 26, height: 26)
                        .overlay(Circle().stroke(RrradioTheme.line))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 14)
            .frame(minHeight: 58)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            Button {
                theme.resetAccent()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(theme.hasCustomAccent ? RrradioTheme.ink3 : RrradioTheme.ink4)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Standard")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(theme.hasCustomAccent ? RrradioTheme.ink : RrradioTheme.ink3)
                        Text("Use rrradio green in light mode and yellow in dark mode.")
                            .font(.system(size: 12))
                            .foregroundStyle(RrradioTheme.ink3)
                            .lineLimit(2)
                    }
                    Spacer()
                    if !theme.hasCustomAccent {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(RrradioTheme.accent)
                    }
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 54)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!theme.hasCustomAccent)
        }
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func acceptAccentPicker() {
        theme.setAccentColor(Color(accentPickerColor))
        showingAccentPicker = false
    }

    private func syncAccentPickerHexDraft(from color: UIColor) {
        accentPickerHexDraft = ThemeController.hexValue(from: Color(color)) ?? ThemeController.classicAccentHex
        accentPickerHexInvalid = false
    }

    private func landingPageRow(_ landingPage: LandingPage) -> some View {
        Button {
            landingPageRaw = landingPage.rawValue
            if landingPage != .stationList {
                landingStationListID = ""
            }
            if landingPage == .station, landingStationID.isEmpty, let station = player.current ?? landingStationOptions.first {
                landingStationID = station.id
            }
            cloudSync.noteSettingsChanged()
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

    private func landingStationListRow(_ list: StationList) -> some View {
        Button {
            landingPageRaw = LandingPage.stationList.rawValue
            landingStationListID = list.id
            landingStationID = ""
            cloudSync.noteSettingsChanged()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: LandingPage.stationList.icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(list.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text("\(list.stations.count) \(list.stations.count == 1 ? "station" : "stations")")
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(2)
                }
                Spacer()
                if currentLandingPage == .stationList && landingStationListID == list.id {
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
                    cloudSync.noteSettingsChanged()
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
            cloudSync.noteSettingsChanged()
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

    private var currentFavoritesDisplayMode: FavoritesDisplayMode {
        FavoritesDisplayMode.normalizedSelection(
            rawValue: favoritesDisplayModeRaw,
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
    }

    private var favoritesDisplayOrder: [FavoritesDisplayMode] {
        FavoritesDisplayMode.normalizedOrder(from: favoritesDisplayModeOrderRaw)
    }

    private var visibleFavoritesDisplayModes: [FavoritesDisplayMode] {
        FavoritesDisplayMode.visibleModes(
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
    }

    private func favoritesDisplayModeConfigurationRow(_ mode: FavoritesDisplayMode, index: Int) -> some View {
        let visible = visibleFavoritesDisplayModes.contains(mode)
        let canHide = !visible || visibleFavoritesDisplayModes.count > 1
        return HStack(spacing: 12) {
            Image(systemName: mode.systemImage)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(visible ? RrradioTheme.ink3 : RrradioTheme.ink4)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(mode.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(visible ? RrradioTheme.ink : RrradioTheme.ink3)
                Text(visible ? "Shown in Library" : "Hidden from Library")
                    .font(.system(size: 12))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            Spacer()
            HStack(spacing: 2) {
                favoritesDisplayModeMoveButton(systemName: "chevron.up", mode: mode, offset: -1, disabled: index == 0)
                favoritesDisplayModeMoveButton(systemName: "chevron.down", mode: mode, offset: 1, disabled: index == favoritesDisplayOrder.count - 1)
            }
            Toggle("", isOn: Binding(
                get: { visible },
                set: { setFavoritesDisplayMode(mode, visible: $0) },
            ))
            .labelsHidden()
            .tint(RrradioTheme.accent)
            .disabled(!canHide)
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

    private func favoritesDisplayModeMoveButton(
        systemName: String,
        mode: FavoritesDisplayMode,
        offset: Int,
        disabled: Bool,
    ) -> some View {
        Button {
            moveFavoritesDisplayMode(mode, by: offset)
        } label: {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(disabled ? RrradioTheme.ink4 : RrradioTheme.ink3)
                .frame(width: 28, height: 28)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func moveFavoritesDisplayMode(_ mode: FavoritesDisplayMode, by offset: Int) {
        let updatedOrder = FavoritesDisplayMode.rawValueByMoving(
            mode,
            by: offset,
            orderRawValue: favoritesDisplayModeOrderRaw,
        )
        guard updatedOrder != favoritesDisplayModeOrderRaw else { return }
        favoritesDisplayModeOrderRaw = updatedOrder
        favoritesDisplayModeVisibleRaw = FavoritesDisplayMode.normalizedVisibleRawValue(
            orderRawValue: updatedOrder,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
        cloudSync.noteSettingsChanged()
    }

    private func setFavoritesDisplayMode(_ mode: FavoritesDisplayMode, visible: Bool) {
        let updatedVisible = FavoritesDisplayMode.rawValueBySettingVisibility(
            mode,
            visible: visible,
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: favoritesDisplayModeVisibleRaw,
        )
        guard updatedVisible != favoritesDisplayModeVisibleRaw else { return }
        favoritesDisplayModeVisibleRaw = updatedVisible
        let normalizedMode = FavoritesDisplayMode.normalizedSelection(
            rawValue: favoritesDisplayModeRaw,
            orderRawValue: favoritesDisplayModeOrderRaw,
            visibleRawValue: updatedVisible,
        )
        if favoritesDisplayModeRaw != normalizedMode.rawValue {
            favoritesDisplayModeRaw = normalizedMode.rawValue
        }
        cloudSync.noteSettingsChanged()
    }

    private func favoritesDisplayModeRow(_ mode: FavoritesDisplayMode) -> some View {
        Button {
            guard visibleFavoritesDisplayModes.contains(mode) else { return }
            favoritesDisplayModeRaw = mode.rawValue
            cloudSync.noteSettingsChanged()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: mode.systemImage)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(mode.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(mode.detail)
                        .font(.system(size: 12))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(2)
                }
                Spacer()
                if currentFavoritesDisplayMode == mode {
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
        uniqueStations(
            [player.current].compactMap { $0 }
                + library.favorites
                + library.recents
                + library.customStations
                + library.stationLists.flatMap(\.stations)
                + catalog.browseOrdered
        )
    }

    private var allLandingStations: [Station] {
        uniqueStations(
            library.customStations
                + library.favorites
                + library.recents
                + library.stationLists.flatMap(\.stations)
                + catalog.browseOrdered
        )
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
        case .library: "Library Home"
        case .recents: locale.text(.recents)
        case .favorites: locale.text(.favorites)
        case .stationList: selectedLandingStationListName
        case .station: locale.text(.playStation)
        }
    }

    private func landingPageDetail(_ landingPage: LandingPage) -> String {
        switch landingPage {
        case .browse: locale.text(.landingBrowseDetail)
        case .library: "Open the Library lists view on launch"
        case .recents: "Open recently played stations on launch"
        case .favorites: "Open favorites in Library on launch"
        case .stationList: "Open a custom station list on launch"
        case .station: locale.text(.landingStationDetail)
        }
    }

    private var selectedLandingStationListName: String {
        library.stationList(id: landingStationListID)?.name ?? locale.text(.stationLists)
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

private struct AccentColorPickerSheet: View {
    @Binding var color: UIColor
    @Binding var hexDraft: String
    @Binding var hexInvalid: Bool
    let onAccept: () -> Void
    let onCancel: () -> Void
    @FocusState private var hexFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Button(action: acceptSelection) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RrradioTheme.bg)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(RrradioTheme.buttonFill))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Accept accent color")

                Text("Accent")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.6)
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(maxWidth: .infinity, alignment: .center)

                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(RrradioTheme.ink2)
                        .frame(width: 36, height: 36)
                        .overlay(Circle().stroke(RrradioTheme.line))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cancel accent color")
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .padding(.top, 18)
            .background(RrradioTheme.bg)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            accentHexRow

            AccentUIColorPicker(
                color: $color,
                onColorChange: handlePickerColorChange,
            )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
        .onAppear(perform: syncHexDraft)
    }

    private var accentHexRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "number")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text("Hex color")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                if hexInvalid {
                    Text("Use #RRGGBB or RGB.")
                        .font(.system(size: 12))
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
            }
            Spacer()
            TextField("#FFFF00", text: $hexDraft)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink)
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .focused($hexFocused)
                .frame(width: 96)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(RrradioTheme.bg)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(hexInvalid ? Color.red : RrradioTheme.line))
                .onSubmit { _ = applyHexDraft() }
        }
        .padding(.horizontal, 18)
        .frame(minHeight: 64)
        .background(RrradioTheme.bg2)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func acceptSelection() {
        let currentHex = ThemeController.hexValue(from: Color(color)) ?? ThemeController.classicAccentHex
        if hexDraft != currentHex,
           !applyHexDraft() {
            return
        }
        onAccept()
    }

    @discardableResult
    private func applyHexDraft() -> Bool {
        guard let color = uiColor(from: hexDraft) else {
            hexInvalid = true
            return false
        }
        self.color = color
        syncHexDraft()
        hexFocused = false
        return true
    }

    private func handlePickerColorChange(_ color: UIColor) {
        self.color = color
        guard !hexFocused else { return }
        syncHexDraft()
    }

    private func syncHexDraft() {
        hexDraft = ThemeController.hexValue(from: Color(color)) ?? ThemeController.classicAccentHex
        hexInvalid = false
    }

    private func uiColor(from value: String) -> UIColor? {
        guard let normalized = ThemeController.normalizedHexValue(value) else { return nil }
        let hex = String(normalized.dropFirst())
        guard let number = Int(hex, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((number >> 16) & 0xFF) / 255,
            green: CGFloat((number >> 8) & 0xFF) / 255,
            blue: CGFloat(number & 0xFF) / 255,
            alpha: 1,
        )
    }
}

private struct AccentUIColorPicker: UIViewControllerRepresentable {
    @Binding var color: UIColor
    let onColorChange: (UIColor) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            color: $color,
            onColorChange: onColorChange,
        )
    }

    func makeUIViewController(context: Context) -> UIColorPickerViewController {
        let picker = UIColorPickerViewController()
        picker.delegate = context.coordinator
        picker.selectedColor = color
        picker.supportsAlpha = false
        if #available(iOS 26.0, *) {
            picker.supportsEyedropper = false
        }
        return picker
    }

    func updateUIViewController(_ viewController: UIColorPickerViewController, context: Context) {
        viewController.supportsAlpha = false
        if #available(iOS 26.0, *) {
            viewController.supportsEyedropper = false
        }
        if !viewController.selectedColor.isEqual(color) {
            viewController.selectedColor = color
        }
    }

    final class Coordinator: NSObject, UIColorPickerViewControllerDelegate {
        private let color: Binding<UIColor>
        private let onColorChange: (UIColor) -> Void

        init(
            color: Binding<UIColor>,
            onColorChange: @escaping (UIColor) -> Void,
        ) {
            self.color = color
            self.onColorChange = onColorChange
        }

        func colorPickerViewController(
            _ viewController: UIColorPickerViewController,
            didSelect color: UIColor,
            continuously: Bool,
        ) {
            self.color.wrappedValue = color
            onColorChange(color)
        }

        func colorPickerViewControllerDidSelectColor(_ viewController: UIColorPickerViewController) {
            color.wrappedValue = viewController.selectedColor
            onColorChange(viewController.selectedColor)
        }
    }
}

private enum SettingsPage: Int, CaseIterable, Identifiable {
    case settings
    case about
    case upload
    case listening

    var id: Int { rawValue }

    @MainActor
    func title(_ locale: LocaleController) -> String {
        switch self {
        case .settings: "Preferences"
        case .about: locale.text(.about)
        case .upload: locale.text(.upload)
        case .listening: "History"
        }
    }
}
