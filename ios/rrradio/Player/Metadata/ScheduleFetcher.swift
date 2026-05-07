import Foundation

struct ProgramScheduleDay: Equatable {
    let date: Date
    let broadcasts: [ProgramScheduleBroadcast]
}

struct ProgramScheduleBroadcast: Identifiable, Equatable {
    let id: String
    let start: Date
    let end: Date
    let title: String
    let subtitle: String?

    init(start: Date, end: Date, title: String, subtitle: String?) {
        self.start = start
        self.end = end
        self.title = title
        self.subtitle = subtitle
        id = "\(Int(start.timeIntervalSince1970 * 1000))-\(Int(end.timeIntervalSince1970 * 1000))-\(title)"
    }
}

typealias StationScheduleFetcher = (Station) async throws -> [ProgramScheduleDay]?

func scheduleFetcher(
    for station: Station,
    fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) -> StationScheduleFetcher? {
    if station.metadata == "orf" || station.metadataUrl?.contains("audioapi.orf.at") == true {
        return { station in
            try await fetchOrfSchedule(station: station, fetch: fetch)
        }
    }
    if station.streamUrl.absoluteString.range(of: #"orf-live\.ors-shoutcast\.at/fm4-"#, options: .regularExpression) != nil {
        return { station in
            var station = station
            station.metadataUrl = "https://audioapi.orf.at/fm4/api/json/4.0/live"
            station.metadata = "orf"
            return try await fetchOrfSchedule(station: station, fetch: fetch)
        }
    }
    return nil
}

private struct OrfScheduleDay: Decodable {
    let date: Int?
    let broadcasts: [OrfScheduleBroadcast]?
}

private struct OrfScheduleBroadcast: Decodable {
    let start: Int
    let end: Int
    let title: String?
    let subtitle: String?
}

func fetchOrfSchedule(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> [ProgramScheduleDay]? {
    guard let url = orfScheduleUrl(for: station) else { return nil }
    let days = try await fetchMetadataJSON([OrfScheduleDay].self, url: url, fetch: fetch)
    let mapped = days.compactMap { day -> ProgramScheduleDay? in
        guard let date = day.date, let broadcasts = day.broadcasts else { return nil }
        let mappedBroadcasts = broadcasts.map { broadcast in
            ProgramScheduleBroadcast(
                start: Date(timeIntervalSince1970: Double(broadcast.start) / 1000),
                end: Date(timeIntervalSince1970: Double(broadcast.end) / 1000),
                title: cleanScheduleTitle(broadcast.title),
                subtitle: metadataStripHTML(broadcast.subtitle),
            )
        }
        guard !mappedBroadcasts.isEmpty else { return nil }
        return ProgramScheduleDay(
            date: Date(timeIntervalSince1970: Double(date) / 1000),
            broadcasts: mappedBroadcasts,
        )
    }
    return mapped.isEmpty ? nil : mapped
}

private func orfScheduleUrl(for station: Station) -> URL? {
    guard let metadataUrl = station.metadataUrl else { return nil }
    let pattern = #"^(https?://audioapi\.orf\.at/[^/]+/api/json/4\.0)/"#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: metadataUrl, range: NSRange(metadataUrl.startIndex..., in: metadataUrl)),
          let range = Range(match.range(at: 1), in: metadataUrl) else {
        return nil
    }
    return URL(string: "\(metadataUrl[range])/broadcasts")
}

private func cleanScheduleTitle(_ value: String?) -> String {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed?.isEmpty == false ? trimmed! : "Untitled"
}
