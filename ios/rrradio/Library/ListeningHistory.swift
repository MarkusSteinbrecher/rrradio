import Foundation
import Observation

enum ListeningHistoryLevel: String, CaseIterable, Identifiable, Codable {
    case stations
    case tracks

    static let storageKey = "rrradio.listeningHistory.level"

    var id: String { rawValue }
}

enum ListeningHistoryRetention: String, CaseIterable, Identifiable, Codable {
    case days30
    case days90
    case year1
    case forever

    static let storageKey = "rrradio.listeningHistory.retention"

    var id: String { rawValue }

    var days: Int? {
        switch self {
        case .days30: 30
        case .days90: 90
        case .year1: 365
        case .forever: nil
        }
    }
}

struct ListeningHistoryRecord: Identifiable, Codable, Hashable {
    let id: UUID
    let stationID: String
    let stationName: String
    let country: String?
    let startedAt: Date
    var endedAt: Date?
    var durationSeconds: TimeInterval
    var trackArtist: String?
    var trackTitle: String?

    var isOpen: Bool { endedAt == nil }
}

struct ListeningHistorySummary {
    let totalSeconds: TimeInterval
    let sessionCount: Int
    let stationCount: Int
    let topStations: [ListeningHistoryStationSummary]
    let topCountries: [ListeningHistoryCountrySummary]
    let recentTracks: [ListeningHistoryTrackSummary]
    let dailyTotals: [ListeningHistoryDaySummary]
    let recentSessions: [ListeningHistoryRecord]
}

struct ListeningHistoryStationSummary: Identifiable {
    let stationID: String
    let stationName: String
    let country: String?
    let totalSeconds: TimeInterval
    let sessionCount: Int

    var id: String { stationID }
}

struct ListeningHistoryCountrySummary: Identifiable {
    let country: String
    let totalSeconds: TimeInterval
    let sessionCount: Int

    var id: String { country }
}

struct ListeningHistoryTrackSummary: Identifiable {
    let artist: String
    let title: String
    let stationName: String
    let lastPlayedAt: Date

    var id: String { "\(artist)\u{1f}\(title)\u{1f}\(lastPlayedAt.timeIntervalSince1970)" }
}

struct ListeningHistoryDaySummary: Identifiable {
    let date: Date
    let totalSeconds: TimeInterval

    var id: Date { date }
}

struct ListeningHistoryRaceSnapshot: Identifiable {
    let date: Date
    let entries: [ListeningHistoryRaceEntry]
    let totalSeconds: TimeInterval

    var id: Date { date }
    var maxSeconds: TimeInterval { max(entries.map(\.totalSeconds).max() ?? 0, 1) }
}

struct ListeningHistoryRaceEntry: Identifiable {
    let stationID: String
    let stationName: String
    let country: String?
    let totalSeconds: TimeInterval
    let rank: Int
    let share: Double

    var id: String { stationID }
}

@Observable
@MainActor
final class ListeningHistory {
    static let enabledKey = "rrradio.listeningHistory.enabled"
    private static let minimumStoredDuration: TimeInterval = 5

    private let defaults: UserDefaults
    private let recordsURL: URL
    private(set) var records: [ListeningHistoryRecord]
    private var activeRecordID: UUID?

    var isEnabled: Bool {
        didSet {
            defaults.set(isEnabled, forKey: Self.enabledKey)
            if !isEnabled {
                closeActiveSession(at: Date())
            }
            onPreferencesChanged?()
        }
    }

    var level: ListeningHistoryLevel {
        didSet {
            defaults.set(level.rawValue, forKey: ListeningHistoryLevel.storageKey)
            if level == .stations {
                stripTrackData()
            }
            onPreferencesChanged?()
        }
    }

    var retention: ListeningHistoryRetention {
        didSet {
            defaults.set(retention.rawValue, forKey: ListeningHistoryRetention.storageKey)
            applyRetention()
            saveRecords()
            onPreferencesChanged?()
        }
    }
    @ObservationIgnored var onPreferencesChanged: (() -> Void)?
    private static let maxRaceSnapshotDays = 366

    init(defaults: UserDefaults = .standard, recordsURL: URL? = nil) {
        self.defaults = defaults
        isEnabled = defaults.bool(forKey: Self.enabledKey)
        level = defaults
            .string(forKey: ListeningHistoryLevel.storageKey)
            .flatMap(ListeningHistoryLevel.init(rawValue:)) ?? .stations
        retention = defaults
            .string(forKey: ListeningHistoryRetention.storageKey)
            .flatMap(ListeningHistoryRetention.init(rawValue:)) ?? .days90
        self.recordsURL = recordsURL ?? Self.makeRecordsURL()
        records = Self.readRecords(from: self.recordsURL)
        applyRetention()
    }

    func applyCloudSyncPreferences(
        enabled nextEnabled: Bool,
        level nextLevel: ListeningHistoryLevel,
        retention nextRetention: ListeningHistoryRetention,
    ) {
        defaults.set(nextEnabled, forKey: Self.enabledKey)
        defaults.set(nextLevel.rawValue, forKey: ListeningHistoryLevel.storageKey)
        defaults.set(nextRetention.rawValue, forKey: ListeningHistoryRetention.storageKey)
        isEnabled = nextEnabled
        level = nextLevel
        retention = nextRetention
    }

    func startSession(for station: Station, at date: Date = Date()) {
        closeActiveSession(at: date)
        guard isEnabled else { return }
        let record = ListeningHistoryRecord(
            id: UUID(),
            stationID: station.id,
            stationName: station.name,
            country: station.country,
            startedAt: date,
            endedAt: nil,
            durationSeconds: 0,
            trackArtist: nil,
            trackTitle: nil,
        )
        records.insert(record, at: 0)
        activeRecordID = record.id
        applyRetention()
        saveRecords()
    }

    func resumeSession(for station: Station, at date: Date = Date()) {
        guard isEnabled else { return }
        if let activeRecordID,
           let current = records.first(where: { $0.id == activeRecordID }),
           current.stationID == station.id {
            return
        }
        startSession(for: station, at: date)
    }

    func closeActiveSession(at date: Date = Date()) {
        guard let activeRecordID,
              let index = records.firstIndex(where: { $0.id == activeRecordID }) else {
            self.activeRecordID = nil
            return
        }

        records[index].endedAt = date
        records[index].durationSeconds = max(0, date.timeIntervalSince(records[index].startedAt))
        self.activeRecordID = nil

        records.removeAll { !$0.isOpen && $0.durationSeconds < Self.minimumStoredDuration }
        applyRetention()
        saveRecords()
    }

    func updateCurrentTrack(artist: String?, title: String?) {
        guard isEnabled, level == .tracks,
              let activeRecordID,
              let index = records.firstIndex(where: { $0.id == activeRecordID }) else { return }

        let artist = clean(artist)
        let title = clean(title)
        guard artist != nil || title != nil else { return }
        guard records[index].trackArtist != artist || records[index].trackTitle != title else { return }

        records[index].trackArtist = artist
        records[index].trackTitle = title
        saveRecords()
    }

    func clear() {
        records = []
        activeRecordID = nil
        saveRecords()
    }

    func summary(for interval: DateInterval? = nil) -> ListeningHistorySummary {
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

        let recentTracks = scoped
            .compactMap { record -> ListeningHistoryTrackSummary? in
                guard let title = record.trackTitle, !title.isEmpty else { return nil }
                return ListeningHistoryTrackSummary(
                    artist: record.trackArtist ?? "",
                    title: title,
                    stationName: record.stationName,
                    lastPlayedAt: record.startedAt,
                )
            }
            .prefix(20)

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
            recentTracks: Array(recentTracks),
            dailyTotals: dailyTotals,
            recentSessions: Array(scoped.prefix(12)),
        )
    }

    func raceSnapshots(for interval: DateInterval? = nil, maxStations: Int = 10) -> [ListeningHistoryRaceSnapshot] {
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

    func exportCSV() -> String {
        let header = [
            "id",
            "station_id",
            "station_name",
            "country",
            "started_at",
            "ended_at",
            "duration_seconds",
            "track_artist",
            "track_title",
        ].joined(separator: ",")
        let rows = records
            .sorted { $0.startedAt > $1.startedAt }
            .map { record in
                [
                    record.id.uuidString,
                    record.stationID,
                    record.stationName,
                    record.country ?? "",
                    record.startedAt.ISO8601Format(),
                    record.endedAt?.ISO8601Format() ?? "",
                    "\(Int(record.durationSeconds.rounded()))",
                    record.trackArtist ?? "",
                    record.trackTitle ?? "",
                ].map(Self.csvField).joined(separator: ",")
            }
        return ([header] + rows).joined(separator: "\n")
    }

    private func stripTrackData() {
        for index in records.indices {
            records[index].trackArtist = nil
            records[index].trackTitle = nil
        }
        saveRecords()
    }

    private func applyRetention() {
        guard let days = retention.days,
              let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date()) else { return }
        records.removeAll { !$0.isOpen && $0.startedAt < cutoff }
    }

    private func saveRecords() {
        do {
            try FileManager.default.createDirectory(
                at: recordsURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
            )
            let data = try JSONEncoder.historyEncoder.encode(records)
            try data.write(to: recordsURL, options: [.atomic])
        } catch {
            // History is best-effort local state; playback must never depend on it.
        }
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func readRecords(from url: URL) -> [ListeningHistoryRecord] {
        guard let data = try? Data(contentsOf: url),
              let records = try? JSONDecoder.historyDecoder.decode([ListeningHistoryRecord].self, from: data) else {
            return []
        }
        return records
    }

    private static func makeRecordsURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appending(path: "rrradio/listening-history.json")
    }

    private static func csvField(_ value: String) -> String {
        let escaped = value.replacingOccurrences(of: "\"", with: "\"\"")
        return "\"\(escaped)\""
    }
}

private extension JSONEncoder {
    static var historyEncoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var historyDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
