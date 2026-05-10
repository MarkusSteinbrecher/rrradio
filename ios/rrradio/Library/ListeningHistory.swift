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

    #if DEBUG
    func seedDemoYear(stations sourceStations: [Station]) {
        let seedStations = Array(sourceStations.filter { $0.featured == true }.prefix(12))
            + Array(sourceStations.filter { $0.featured != true }.prefix(18))
        let stations = Array(seedStations.prefix(18))
        guard !stations.isEmpty else { return }

        isEnabled = true
        level = .tracks
        retention = .year1
        activeRecordID = nil

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        var seeded: [ListeningHistoryRecord] = []

        for dayOffset in stride(from: 364, through: 0, by: -1) {
            guard let day = calendar.date(byAdding: .day, value: -dayOffset, to: today) else { continue }
            let weekday = calendar.component(.weekday, from: day)
            let listensToday = demoSessionCount(dayOffset: dayOffset, weekday: weekday)
            guard listensToday > 0 else { continue }

            for sessionIndex in 0..<listensToday {
                let station = demoStation(for: dayOffset, sessionIndex: sessionIndex, stations: stations)
                let minute = 20 + ((dayOffset * 19 + sessionIndex * 37) % 760)
                let durationMinutes = 12 + ((dayOffset * 11 + sessionIndex * 23) % 104)
                let startedAt = calendar.date(byAdding: .minute, value: minute, to: day) ?? day
                let duration = TimeInterval(durationMinutes * 60)
                let track = demoTrack(dayOffset: dayOffset, sessionIndex: sessionIndex)
                seeded.append(ListeningHistoryRecord(
                    id: UUID(),
                    stationID: station.id,
                    stationName: station.name,
                    country: station.country,
                    startedAt: startedAt,
                    endedAt: startedAt.addingTimeInterval(duration),
                    durationSeconds: duration,
                    trackArtist: track.artist,
                    trackTitle: track.title,
                ))
            }
        }

        records = seeded.sorted { $0.startedAt > $1.startedAt }
        applyRetention()
        saveRecords()
    }

    private func demoSessionCount(dayOffset: Int, weekday: Int) -> Int {
        if dayOffset % 13 == 0 { return 0 }
        let base = weekday == 1 || weekday == 7 ? 2 : 1
        let extra = dayOffset % 9 == 0 ? 2 : dayOffset % 4 == 0 ? 1 : 0
        return min(base + extra, 5)
    }

    private func demoStation(for dayOffset: Int, sessionIndex: Int, stations: [Station]) -> Station {
        let seasonalShift = (dayOffset / 45) % max(stations.count, 1)
        let weightedIndex: Int
        switch (dayOffset + sessionIndex * 3) % 10 {
        case 0...3: weightedIndex = 0
        case 4...5: weightedIndex = 1
        case 6: weightedIndex = 2
        default: weightedIndex = (dayOffset + sessionIndex + seasonalShift) % stations.count
        }
        return stations[min(weightedIndex, stations.count - 1)]
    }

    private func demoTrack(dayOffset: Int, sessionIndex: Int) -> (artist: String, title: String) {
        let artists = ["Mira Vale", "Northern Service", "Le Club", "Paper Lights", "Azul Mono"]
        let titles = ["Late Signal", "Small Hours", "Across Town", "Frequency", "Window Seat"]
        return (
            artists[(dayOffset + sessionIndex) % artists.count],
            titles[(dayOffset * 2 + sessionIndex) % titles.count]
        )
    }
    #endif

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
        var cursor = start

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
