import Foundation

struct RadioBrowserClient {
    static let pageSize = 60

    private let seedHosts = [
        "de1.api.radio-browser.info",
        "at1.api.radio-browser.info",
        "nl1.api.radio-browser.info",
    ]
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func search(
        query: String? = nil,
        tag: String? = nil,
        country: String? = nil,
        offset: Int = 0,
        limit: Int = Self.pageSize,
    ) async throws -> [Station] {
        var components = URLComponents()
        components.scheme = "https"
        components.host = seedHosts[0]
        components.path = "/json/stations/search"
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "order", value: "votes"),
            URLQueryItem(name: "reverse", value: "true"),
            URLQueryItem(name: "hidebroken", value: "true"),
        ]
        if let query = looseSearchQuery(query), !query.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "name", value: query))
        }
        if let tag, !tag.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "tag", value: tag))
        }
        if let country, !country.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "countrycode", value: country.uppercased()))
        }
        guard let url = components.url else { return [] }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        let raw = try JSONDecoder().decode([RadioBrowserStation].self, from: data)
        return dedupeByStreamUrl(raw.filter { !$0.effectiveURL.isEmpty }).map(\.station)
    }

    private func looseSearchQuery(_ query: String?) -> String? {
        guard let query else { return nil }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            return trimmed
        }
        var result = ""
        let chars = Array(trimmed)
        for (index, char) in chars.enumerated() {
            if index > 0 {
                let previous = chars[index - 1]
                if (previous.isLetter && char.isNumber) || (previous.isNumber && char.isLetter) {
                    result.append(" ")
                }
            }
            result.append(char)
        }
        return result
    }

    private func dedupeByStreamUrl(_ stations: [RadioBrowserStation]) -> [RadioBrowserStation] {
        func score(_ station: RadioBrowserStation) -> Int {
            let favicon = (station.favicon ?? "").lowercased()
            let hasRealLogo = !favicon.isEmpty && !favicon.hasSuffix("/favicon.ico") ? 1 : 0
            let hasTags = station.tags?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? 1 : 0
            return hasRealLogo * 1000 + hasTags * 100 + (station.clickcount ?? 0)
        }

        var winners: [String: RadioBrowserStation] = [:]
        for station in stations {
            let key = normalizeStreamUrl(station.effectiveURL)
            if let incumbent = winners[key], score(incumbent) >= score(station) {
                continue
            }
            winners[key] = station
        }
        return Array(winners.values)
    }

    private func normalizeStreamUrl(_ value: String) -> String {
        guard var components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
        components.scheme = "https"
        components.host = components.host?.lowercased()
        if components.port == 80 || components.port == 443 {
            components.port = nil
        }
        var normalized = components.url?.absoluteString ?? value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized
    }
}

private struct RadioBrowserStation: Decodable {
    let stationuuid: String
    let name: String?
    let url: String?
    let urlResolved: String?
    let homepage: String?
    let favicon: String?
    let tags: String?
    let countrycode: String?
    let bitrate: Int?
    let codec: String?
    let clickcount: Int?
    let geoLat: Double?
    let geoLong: Double?

    enum CodingKeys: String, CodingKey {
        case stationuuid, name, url, homepage, favicon, tags, countrycode, bitrate, codec, clickcount
        case urlResolved = "url_resolved"
        case geoLat = "geo_lat"
        case geoLong = "geo_long"
    }

    var effectiveURL: String {
        let resolved = urlResolved?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !resolved.isEmpty { return resolved }
        return url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var station: Station {
        Station(
            id: "rb-\(stationuuid)",
            name: name?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? name!.trimmingCharacters(in: .whitespacesAndNewlines) : "Unknown",
            streamUrl: URL(string: effectiveURL)!,
            homepage: homepage.flatMap(URL.init(string:)),
            country: countrycode?.isEmpty == false ? countrycode : nil,
            tags: parsedTags,
            favicon: favicon.flatMap(URL.init(string:)),
            bitrate: (bitrate ?? 0) > 0 ? bitrate : nil,
            codec: codec?.isEmpty == false ? codec?.uppercased() : nil,
            listeners: (clickcount ?? 0) > 0 ? clickcount : nil,
            geo: geoLat.flatMap { lat in geoLong.map { [lat, $0] } },
        )
    }

    private var parsedTags: [String]? {
        guard let tags else { return nil }
        let parsed = tags
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parsed.isEmpty ? nil : parsed
    }
}

