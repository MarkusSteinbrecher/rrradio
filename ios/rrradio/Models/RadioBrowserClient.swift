import Foundation

final class RadioBrowserClient {
    static let pageSize = 60

    private let seedHosts = [
        "de1.api.radio-browser.info",
        "at1.api.radio-browser.info",
        "nl1.api.radio-browser.info",
    ]
    private let session: URLSession
    private let userAgent: String
    private var lastSuccessfulHost: String?

    init(session: URLSession = .shared, userAgent: String = RadioBrowserClient.defaultUserAgent) {
        self.session = session
        self.userAgent = userAgent
    }

    func stationCount() async throws -> Int? {
        diagnosticRecordAsync("radio-browser", "station count requested")
        let data = try await dataWithMirrorFailover(path: "/json/stats")
        do {
            let count = try JSONDecoder().decode(RadioBrowserStats.self, from: data).stations
            diagnosticRecordAsync("radio-browser", "station count loaded", details: ["count": count.map(String.init) ?? "unknown"])
            return count
        } catch {
            diagnosticRecordAsync("radio-browser", "station count failed", details: ["error": error.localizedDescription])
            throw error
        }
    }

    func search(
        query: String? = nil,
        tag: String? = nil,
        country: String? = nil,
        offset: Int = 0,
        limit: Int = RadioBrowserClient.pageSize,
    ) async throws -> [Station] {
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "order", value: "votes"),
            URLQueryItem(name: "reverse", value: "true"),
            URLQueryItem(name: "hidebroken", value: "true"),
        ]
        if let query = looseSearchQuery(query), !query.isEmpty {
            queryItems.append(URLQueryItem(name: "name", value: query))
        }
        if let tag, !tag.isEmpty {
            queryItems.append(URLQueryItem(name: "tag", value: tag))
        }
        if let country, !country.isEmpty {
            queryItems.append(URLQueryItem(name: "countrycode", value: country.uppercased()))
        }
        diagnosticRecordAsync(
            "radio-browser",
            "search requested",
            details: [
                "query": query ?? "",
                "tag": tag ?? "",
                "country": country ?? "",
                "offset": String(offset),
                "limit": String(limit),
            ],
        )
        let data: Data
        do {
            data = try await dataWithMirrorFailover(path: "/json/stations/search", queryItems: queryItems)
            let raw = try JSONDecoder().decode([RadioBrowserStation].self, from: data)
            let stations = dedupeByStreamUrl(raw.filter { !$0.effectiveURL.isEmpty }).compactMap(\.station)
            diagnosticRecordAsync(
                "radio-browser",
                "search loaded",
                details: ["raw": String(raw.count), "stations": String(stations.count), "offset": String(offset)],
            )
            return stations
        } catch {
            diagnosticRecordAsync("radio-browser", "search failed", details: ["error": error.localizedDescription, "offset": String(offset)])
            throw error
        }
    }

    private func dataWithMirrorFailover(path: String, queryItems: [URLQueryItem] = []) async throws -> Data {
        var lastError: Error = URLError(.badServerResponse)
        for host in orderedHosts() {
            guard let request = request(host: host, path: path, queryItems: queryItems) else { continue }
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    lastError = URLError(.badServerResponse)
                    diagnosticRecordAsync("radio-browser", "mirror failed", details: ["host": host, "error": "bad status"])
                    continue
                }
                lastSuccessfulHost = host
                diagnosticRecordAsync("radio-browser", "mirror loaded", details: ["host": host])
                return data
            } catch let error as URLError {
                lastError = error
                diagnosticRecordAsync("radio-browser", "mirror failed", details: ["host": host, "error": error.localizedDescription])
            }
        }
        throw lastError
    }

    private func request(host: String, path: String, queryItems: [URLQueryItem]) -> URLRequest? {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        return request
    }

    private func orderedHosts() -> [String] {
        guard let lastSuccessfulHost, seedHosts.contains(lastSuccessfulHost) else { return seedHosts }
        return [lastSuccessfulHost] + seedHosts.filter { $0 != lastSuccessfulHost }
    }

    private static var defaultUserAgent: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
        return "rrradio-ios/\(version)"
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

private struct RadioBrowserStats: Decodable {
    let stations: Int?
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

    var station: Station? {
        guard let streamUrl = URL(string: effectiveURL), streamUrl.scheme != nil else { return nil }
        return Station(
            id: "rb-\(stationuuid)",
            name: name?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? name!.trimmingCharacters(in: .whitespacesAndNewlines) : "Unknown",
            streamUrl: streamUrl,
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
