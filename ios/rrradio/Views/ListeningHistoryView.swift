import MessageUI
import SwiftUI

struct ListeningHistoryPageView: View {
    @Environment(ListeningHistory.self) private var history
    @Environment(Catalog.self) private var catalog
    @State private var range: RangeChoice = .days30
    @State private var confirmingClear = false
    @State private var showingMailComposer = false
    @State private var showingShareExporter = false
    @State private var refreshedAt = Date()
    @State private var dashboardData: ListeningDashboardData?
    @State private var isLoadingDashboard = false

    private enum RangeChoice: String, CaseIterable, Identifiable {
        case days7
        case days30
        case all

        var id: String { rawValue }

        var title: String {
            switch self {
            case .days7: "7 days"
            case .days30: "30 days"
            case .all: "All"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Listening history")
                            .font(.system(size: 30, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                        Text("stored on your phone only")
                            .font(.system(size: 15, weight: .regular))
                            .foregroundStyle(RrradioTheme.ink3)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 10)

                    Button {
                        if MFMailComposeViewController.canSendMail() {
                            showingMailComposer = true
                        } else {
                            showingShareExporter = true
                        }
                    } label: {
                        mailIcon
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Send listening history")

                    Button {
                        refreshedAt = Date()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink3)
                            .frame(width: 36, height: 36)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Refresh listening history")
                }

                Picker("Range", selection: $range) {
                    ForEach(RangeChoice.allCases) { choice in
                        Text(choice.title).tag(choice)
                    }
                }
                .pickerStyle(.segmented)
                .tint(RrradioTheme.accent)

                if history.isEnabled {
                    enabledDashboard
                } else {
                    disabledState
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
        .confirmationDialog(
            "Clear listening history?",
            isPresented: $confirmingClear,
            titleVisibility: .visible,
        ) {
            Button("Clear history", role: .destructive) {
                history.clear()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the local listening history from this device.")
        }
        .sheet(isPresented: $showingMailComposer) {
            MailComposer(
                subject: mailSubject,
                attachment: Data(history.exportCSV().utf8),
                attachmentName: mailAttachmentName,
            )
        }
        .sheet(isPresented: $showingShareExporter) {
            NavigationStack {
                VStack(spacing: 18) {
                    ShareLink(
                        item: history.exportCSV(),
                        subject: Text(mailSubject),
                        message: Text("Listening history exported from rrradio."),
                    ) {
                        Label("Share listening history", systemImage: "square.and.arrow.up")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(RrradioTheme.bg)
                            .padding(.horizontal, 16)
                            .frame(height: 44)
                            .background(RrradioTheme.buttonFill)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(RrradioTheme.bg.ignoresSafeArea())
                .navigationTitle("Export history")
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .task(id: dashboardRefreshKey) {
            await refreshDashboard()
        }
        .onDisappear {
            dashboardData = nil
        }
    }

    private var mailIcon: some View {
        Image(systemName: "envelope")
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(RrradioTheme.ink3)
            .frame(width: 36, height: 36)
            .contentShape(Circle())
    }

    private var mailSubject: String {
        "Saved listening history from \(Date.now.formatted(date: .numeric, time: .omitted))"
    }

    private var mailAttachmentName: String {
        let rawDate = Date.now.formatted(.iso8601.year().month().day())
        return "rrradio-listening-history-\(rawDate).csv"
    }

    private var dashboardRefreshKey: String {
        [
            range.rawValue,
            "\(Int(refreshedAt.timeIntervalSince1970))",
            "\(history.records.count)",
            "\(history.isEnabled)",
            history.level.rawValue,
        ].joined(separator: ":")
    }

    private func refreshDashboard() async {
        guard history.isEnabled else {
            dashboardData = nil
            isLoadingDashboard = false
            return
        }

        isLoadingDashboard = true
        dashboardData = nil

        let records = history.records
        let interval = selectedInterval
        let includesTracks = history.level == .tracks
        let data = await Task.detached(priority: .userInitiated) {
            ListeningDashboardData.build(
                records: records,
                interval: interval,
                includesTracks: includesTracks,
            )
        }.value

        guard !Task.isCancelled else { return }
        dashboardData = data
        isLoadingDashboard = false
    }

    private var enabledDashboard: some View {
        VStack(alignment: .leading, spacing: 22) {
            if let dashboardData {
                dashboardContent(dashboardData)
            } else if isLoadingDashboard {
                loadingDashboard
            } else {
                emptyDashboard
            }

            Button(role: .destructive) {
                confirmingClear = true
            } label: {
                HStack {
                    Image(systemName: "trash")
                    Text("Clear listening history")
                    Spacer()
                }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.red)
                .padding(.horizontal, 14)
                .frame(minHeight: 52)
                .background(RrradioTheme.bg2)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func dashboardContent(_ data: ListeningDashboardData) -> some View {
        let summary = data.summary
        HStack(spacing: 0) {
            statTile("Time", value: durationText(summary.totalSeconds))
            statTile("Sessions", value: "\(summary.sessionCount)")
            statTile("Stations", value: "\(summary.stationCount)")
        }
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))

        if summary.sessionCount == 0 {
            emptyDashboard
        } else {
            dashboardSection("Most listened") {
                ListeningRaceChart(
                    snapshots: data.raceSnapshots,
                    stations: catalog.stations,
                )
            }

            dashboardSection("Minutes by day") {
                dayBars(summary.dailyTotals, interval: selectedInterval)
            }

            dashboardSection("Countries") {
                VStack(spacing: 0) {
                    ForEach(summary.topCountries) { row in
                        metricRow(
                            title: row.country,
                            detail: "\(row.sessionCount)x",
                            value: durationText(row.totalSeconds),
                        )
                    }
                }
            }

            if data.includesTracks && !summary.recentTracks.isEmpty {
                dashboardSection("Recent tracks") {
                    VStack(spacing: 0) {
                        ForEach(summary.recentTracks) { row in
                            metricRow(
                                title: trackTitle(row),
                                detail: row.stationName,
                                value: relativeDate(row.lastPlayedAt),
                            )
                        }
                    }
                }
            }
        }
    }

    private var disabledState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(RrradioTheme.accent)
            Text("Listening history is off")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(RrradioTheme.ink)
            Text("Turn it on to build a local dashboard of stations, listening time, countries, and optional track titles. Nothing is sent to rrradio.org.")
                .font(.system(size: 14))
                .foregroundStyle(RrradioTheme.ink3)
            Button {
                history.isEnabled = true
            } label: {
                Text("Enable local history")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(RrradioTheme.bg)
                    .padding(.horizontal, 16)
                    .frame(height: 40)
                    .background(RrradioTheme.buttonFill)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var emptyDashboard: some View {
        Text("No listening sessions in this range yet.")
            .font(.system(size: 14))
            .foregroundStyle(RrradioTheme.ink3)
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RrradioTheme.bg2)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var loadingDashboard: some View {
        HStack(spacing: 12) {
            ProgressView()
                .tint(RrradioTheme.accent)
            Text("Loading listening history...")
                .font(.system(size: 14))
                .foregroundStyle(RrradioTheme.ink3)
            Spacer()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func dashboardSection<Content: View>(
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
                .background(RrradioTheme.bg2)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private func statTile(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.1)
                .foregroundStyle(RrradioTheme.ink3)
            Text(value)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(RrradioTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func metricRow(title: String, detail: String, value: String) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(1)
                }
            }
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink3)
                .lineLimit(1)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func dayBars(_ days: [ListeningHistoryDaySummary], interval: DateInterval?) -> some View {
        let series = daySeries(days, interval: interval)
        let maxSeconds = max(series.map(\.totalSeconds).max() ?? 0, 1)
        return VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                let spacing: CGFloat = 1
                let count = max(series.count, 1)
                let barWidth = max(1, (proxy.size.width - CGFloat(count - 1) * spacing) / CGFloat(count))
                HStack(alignment: .bottom, spacing: spacing) {
                    ForEach(series) { day in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(day.totalSeconds > 0 ? RrradioTheme.accent : RrradioTheme.line)
                            .frame(
                                width: barWidth,
                                height: day.totalSeconds > 0 ? max(3, CGFloat(day.totalSeconds / maxSeconds) * 82) : 3,
                            )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
            .frame(height: 88)

            HStack {
                Text(series.first?.date.formatted(date: .abbreviated, time: .omitted) ?? "")
                Spacer()
                Text(series.last?.date.formatted(date: .abbreviated, time: .omitted) ?? "")
            }
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(RrradioTheme.ink3)
        }
        .padding(14)
        .frame(minHeight: 126)
    }

    private func daySeries(_ days: [ListeningHistoryDaySummary], interval: DateInterval?) -> [ListeningHistoryDaySummary] {
        let maxVisibleDays = 366
        let calendar = Calendar.current
        let totalsByDay = Dictionary(uniqueKeysWithValues: days.map { (calendar.startOfDay(for: $0.date), $0.totalSeconds) })
        guard let start = interval.map({ calendar.startOfDay(for: $0.start) }) ?? days.map({ calendar.startOfDay(for: $0.date) }).min(),
              let end = interval.map({ calendar.startOfDay(for: $0.end) }) ?? days.map({ calendar.startOfDay(for: $0.date) }).max() else {
            return []
        }

        let boundedStart: Date
        if let visibleStart = calendar.date(byAdding: .day, value: -(maxVisibleDays - 1), to: end),
           start < visibleStart {
            boundedStart = visibleStart
        } else {
            boundedStart = start
        }

        var result: [ListeningHistoryDaySummary] = []
        var cursor = boundedStart
        while cursor <= end {
            result.append(ListeningHistoryDaySummary(date: cursor, totalSeconds: totalsByDay[cursor, default: 0]))
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return result
    }

    private var selectedInterval: DateInterval? {
        let calendar = Calendar.current
        let end = Date()
        let days: Int
        switch range {
        case .days7:
            days = 7
        case .days30:
            days = 30
        case .all:
            return nil
        }
        let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: end)) ?? end
        return DateInterval(start: start, end: end)
    }

    private func durationText(_ seconds: TimeInterval) -> String {
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let remainder = minutes % 60
        return remainder == 0 ? "\(hours)h" : "\(hours)h \(remainder)m"
    }

    private func relativeDate(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    private func trackTitle(_ row: ListeningHistoryTrackSummary) -> String {
        row.artist.isEmpty ? row.title : "\(row.artist) - \(row.title)"
    }
}

private struct ListeningDashboardData {
    let summary: ListeningHistorySummary
    let raceSnapshots: [ListeningHistoryRaceSnapshot]
    let includesTracks: Bool

    private static let minimumStoredDuration: TimeInterval = 5
    private static let maxRaceSnapshotDays = 366

    static func build(
        records: [ListeningHistoryRecord],
        interval: DateInterval?,
        includesTracks: Bool,
    ) -> ListeningDashboardData {
        let now = Date()
        let measured = records.map { record in
            var copy = record
            if copy.isOpen {
                copy.durationSeconds = max(0, now.timeIntervalSince(copy.startedAt))
            }
            return copy
        }
        let closed = measured.filter { $0.durationSeconds >= Self.minimumStoredDuration }
        let scoped = interval.map { range in
            closed.filter { range.contains($0.startedAt) }
        } ?? closed

        return ListeningDashboardData(
            summary: summary(for: scoped, includesTracks: includesTracks),
            raceSnapshots: raceSnapshots(for: scoped, interval: interval, now: now, maxStations: 10),
            includesTracks: includesTracks,
        )
    }

    private static func summary(
        for scoped: [ListeningHistoryRecord],
        includesTracks: Bool,
    ) -> ListeningHistorySummary {
        let totalSeconds = scoped.reduce(0) { $0 + $1.durationSeconds }
        let stationIDs = Set(scoped.map(\.stationID))
        let topStations = scoped
            .reduce(into: [String: (name: String, country: String?, seconds: TimeInterval, count: Int)]()) { result, record in
                var current = result[record.stationID] ?? (record.stationName, record.country, 0, 0)
                current.seconds += record.durationSeconds
                current.count += 1
                result[record.stationID] = current
            }
            .map { key, value in
                ListeningHistoryStationSummary(
                    stationID: key,
                    stationName: value.name,
                    country: value.country,
                    totalSeconds: value.seconds,
                    sessionCount: value.count,
                )
            }
            .sorted { $0.totalSeconds > $1.totalSeconds }

        let topCountries = scoped
            .reduce(into: [String: (seconds: TimeInterval, count: Int)]()) { result, record in
                let country = record.country?.uppercased() ?? "??"
                var current = result[country] ?? (0, 0)
                current.seconds += record.durationSeconds
                current.count += 1
                result[country] = current
            }
            .map { key, value in
                ListeningHistoryCountrySummary(country: key, totalSeconds: value.seconds, sessionCount: value.count)
            }
            .sorted { $0.totalSeconds > $1.totalSeconds }

        let recentTracks: [ListeningHistoryTrackSummary]
        if includesTracks {
            recentTracks = Array(scoped
                .compactMap { record -> ListeningHistoryTrackSummary? in
                    guard let title = record.trackTitle, !title.isEmpty else { return nil }
                    return ListeningHistoryTrackSummary(
                        artist: record.trackArtist ?? "",
                        title: title,
                        stationName: record.stationName,
                        lastPlayedAt: record.startedAt,
                    )
                }
                .prefix(20))
        } else {
            recentTracks = []
        }

        let dailyTotals = scoped
            .reduce(into: [Date: TimeInterval]()) { result, record in
                let day = Calendar.current.startOfDay(for: record.startedAt)
                result[day, default: 0] += record.durationSeconds
            }
            .map { ListeningHistoryDaySummary(date: $0.key, totalSeconds: $0.value) }
            .sorted { $0.date < $1.date }

        return ListeningHistorySummary(
            totalSeconds: totalSeconds,
            sessionCount: scoped.count,
            stationCount: stationIDs.count,
            topStations: Array(topStations.prefix(12)),
            topCountries: Array(topCountries.prefix(8)),
            recentTracks: recentTracks,
            dailyTotals: dailyTotals,
            recentSessions: Array(scoped.prefix(12)),
        )
    }

    private static func raceSnapshots(
        for scoped: [ListeningHistoryRecord],
        interval: DateInterval?,
        now: Date,
        maxStations: Int,
    ) -> [ListeningHistoryRaceSnapshot] {
        guard !scoped.isEmpty else { return [] }

        let calendar = Calendar.current
        let start = interval.map { calendar.startOfDay(for: $0.start) }
            ?? scoped.map { calendar.startOfDay(for: $0.startedAt) }.min()
            ?? calendar.startOfDay(for: now)
        let end = interval.map { calendar.startOfDay(for: $0.end) }
            ?? scoped.map { calendar.startOfDay(for: $0.startedAt) }.max()
            ?? calendar.startOfDay(for: now)

        let recordsByDay = scoped.reduce(into: [Date: [ListeningHistoryRecord]]()) { result, record in
            let day = calendar.startOfDay(for: record.startedAt)
            result[day, default: []].append(record)
        }

        var totals: [String: (name: String, country: String?, seconds: TimeInterval)] = [:]
        var snapshots: [ListeningHistoryRaceSnapshot] = []
        let boundedStart: Date
        if let visibleStart = calendar.date(byAdding: .day, value: -(Self.maxRaceSnapshotDays - 1), to: end),
           start < visibleStart {
            boundedStart = visibleStart
            for record in scoped where calendar.startOfDay(for: record.startedAt) < boundedStart {
                var current = totals[record.stationID] ?? (record.stationName, record.country, 0)
                current.seconds += record.durationSeconds
                totals[record.stationID] = current
            }
        } else {
            boundedStart = start
        }

        var cursor = boundedStart
        while cursor <= end {
            for record in recordsByDay[cursor, default: []] {
                var current = totals[record.stationID] ?? (record.stationName, record.country, 0)
                current.seconds += record.durationSeconds
                totals[record.stationID] = current
            }

            let totalSeconds = totals.values.reduce(0) { $0 + $1.seconds }
            let entries = totals
                .map { key, value in
                    (stationID: key, stationName: value.name, country: value.country, totalSeconds: value.seconds)
                }
                .sorted { lhs, rhs in
                    if lhs.totalSeconds == rhs.totalSeconds {
                        return lhs.stationName.localizedCaseInsensitiveCompare(rhs.stationName) == .orderedAscending
                    }
                    return lhs.totalSeconds > rhs.totalSeconds
                }
                .prefix(maxStations)
                .enumerated()
                .map { index, value in
                    ListeningHistoryRaceEntry(
                        stationID: value.stationID,
                        stationName: value.stationName,
                        country: value.country,
                        totalSeconds: value.totalSeconds,
                        rank: index + 1,
                        share: totalSeconds > 0 ? value.totalSeconds / totalSeconds : 0,
                    )
                }

            if !entries.isEmpty {
                snapshots.append(ListeningHistoryRaceSnapshot(date: cursor, entries: Array(entries), totalSeconds: totalSeconds))
            }

            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }

        return snapshots
    }
}

private struct MailComposer: UIViewControllerRepresentable {
    let subject: String
    let attachment: Data
    let attachmentName: String
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let controller = MFMailComposeViewController()
        controller.mailComposeDelegate = context.coordinator
        controller.setSubject(subject)
        controller.setMessageBody("Listening history exported from rrradio.", isHTML: false)
        controller.addAttachmentData(
            attachment,
            mimeType: "text/csv",
            fileName: attachmentName,
        )
        return controller
    }

    func updateUIViewController(_ uiViewController: MFMailComposeViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(dismiss: dismiss)
    }

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        private let dismiss: DismissAction

        init(dismiss: DismissAction) {
            self.dismiss = dismiss
        }

        func mailComposeController(
            _ controller: MFMailComposeViewController,
            didFinishWith result: MFMailComposeResult,
            error: Error?,
        ) {
            dismiss()
        }
    }
}
