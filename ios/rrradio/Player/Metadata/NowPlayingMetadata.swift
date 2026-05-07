import Foundation

struct NowPlayingMetadata: Equatable {
    let artist: String?
    let title: String?
    let raw: String
    var programName: String? = nil
    var programSubtitle: String? = nil
    var coverUrl: URL? = nil
}

typealias MetadataDataFetcher = (URLRequest) async throws -> (Data, URLResponse)
typealias StationMetadataFetcher = (Station) async throws -> NowPlayingMetadata?

func metadataFetcher(for station: Station, fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) }) -> StationMetadataFetcher? {
    if station.metadata == "orf" || station.metadataUrl?.contains("audioapi.orf.at") == true {
        return { station in
            try await fetchOrfMetadata(station: station, fetch: fetch)
        }
    }
    if station.streamUrl.absoluteString.range(of: #"orf-live\.ors-shoutcast\.at/fm4-"#, options: .regularExpression) != nil {
        return { station in
            var station = station
            station.metadataUrl = "https://audioapi.orf.at/fm4/api/json/4.0/live"
            station.metadata = "orf"
            return try await fetchOrfMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "azuracast" {
        return { station in
            try await fetchAzuracastMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "laut-fm" {
        return { station in
            try await fetchLautFmMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "streamabc" {
        return { station in
            try await fetchStreamabcMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "swr" {
        return { station in
            try await fetchSwrMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "ffh" {
        return { station in
            try await fetchFfhMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "mdr" {
        return { station in
            try await fetchMdrMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "rbb-radioeins" {
        return { station in
            try await fetchRadioEinsMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "cro" {
        return { station in
            try await fetchCroMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "srgssr-il" {
        return { station in
            try await fetchSrgssrIlMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "swiss-radio" {
        return { station in
            try await fetchRadioSwissMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "srr" {
        return { station in
            try await fetchSrrMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "mr" {
        return { station in
            try await fetchMrMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "br-radioplayer" {
        return { station in
            try await fetchBrMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "bbc" {
        return { station in
            try await fetchBbcMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "hr" {
        return { station in
            try await fetchHrMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "antenne" {
        return { station in
            try await fetchAntenneMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "rb-bremen" {
        return { station in
            try await fetchRadioBremenMetadata(station: station, fetch: fetch)
        }
    }
    if station.metadata == "sr" {
        return { station in
            try await fetchSrMetadata(station: station, fetch: fetch)
        }
    }
    if station.status == "icy-only" {
        return { station in
            try await fetchIcyMetadata(station: station)
        }
    }
    return nil
}
