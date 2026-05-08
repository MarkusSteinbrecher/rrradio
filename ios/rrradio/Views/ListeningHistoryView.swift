import MessageUI
import SwiftUI

struct ListeningHistoryPageView: View {
    @Environment(ListeningHistory.self) private var history
    @Environment(Catalog.self) private var catalog
    @State private var range: RangeChoice = .all
    @State private var confirmingClear = false
    @State private var showingMailComposer = false
    @State private var refreshedAt = Date()

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

                    if MFMailComposeViewController.canSendMail() {
                        Button {
                            showingMailComposer = true
                        } label: {
                            mailIcon
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Email listening history")
                    } else {
                        ShareLink(
                            item: history.exportCSV(),
                            subject: Text(mailSubject),
                            message: Text("Listening history exported from rrradio.")
                        ) {
                            mailIcon
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Send listening history")
                    }

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

    private var enabledDashboard: some View {
        let summary = history.summary(for: selectedInterval)
        return VStack(alignment: .leading, spacing: 22) {
            #if DEBUG
            demoHistoryButton
            #endif

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
                        snapshots: history.raceSnapshots(for: selectedInterval, maxStations: 10),
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

                if history.level == .tracks && !summary.recentTracks.isEmpty {
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

    #if DEBUG
    private var demoHistoryButton: some View {
        Button {
            history.seedDemoYear(stations: catalog.stations)
            range = .all
            refreshedAt = Date()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "wand.and.stars")
                    .font(.system(size: 14, weight: .semibold))
                Text("Seed one year demo history")
                    .font(.system(size: 13, weight: .medium))
                Spacer()
                Text("DEBUG")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            .foregroundStyle(RrradioTheme.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(RrradioTheme.bg2)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
    #endif

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
        let calendar = Calendar.current
        let totalsByDay = Dictionary(uniqueKeysWithValues: days.map { (calendar.startOfDay(for: $0.date), $0.totalSeconds) })
        guard let start = interval.map({ calendar.startOfDay(for: $0.start) }) ?? days.map({ calendar.startOfDay(for: $0.date) }).min(),
              let end = interval.map({ calendar.startOfDay(for: $0.end) }) ?? days.map({ calendar.startOfDay(for: $0.date) }).max() else {
            return []
        }

        var result: [ListeningHistoryDaySummary] = []
        var cursor = start
        while cursor <= end {
            result.append(ListeningHistoryDaySummary(date: cursor, totalSeconds: totalsByDay[cursor, default: 0]))
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return result
    }

    private var selectedInterval: DateInterval? { nil }

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
