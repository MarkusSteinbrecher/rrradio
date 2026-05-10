import Foundation

enum CustomStationValidationError: LocalizedError, Equatable {
    case missingName
    case missingStreamURL
    case invalidStreamURL
    case unsupportedStreamURLScheme
    case duplicateStreamURL
    case invalidHomepage
    case invalidCountry

    var errorDescription: String? {
        switch self {
        case .missingName:
            return "Name is required."
        case .missingStreamURL:
            return "Stream URL is required."
        case .invalidStreamURL:
            return "Stream URL must be a valid URL."
        case .unsupportedStreamURLScheme:
            return "Stream URL must use http:// or https://."
        case .duplicateStreamURL:
            return "This stream URL is already in rrradio."
        case .invalidHomepage:
            return "Homepage must be a valid http:// or https:// URL."
        case .invalidCountry:
            return "Country must be a 2-letter code, for example CH."
        }
    }
}

func makeCustomStation(
    name rawName: String,
    streamURL rawStreamURL: String,
    homepage rawHomepage: String = "",
    country rawCountry: String = "",
    tags rawTags: String = "",
    id: String = "custom-\(UUID().uuidString)",
) throws -> Station {
    let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { throw CustomStationValidationError.missingName }

    let streamValue = rawStreamURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !streamValue.isEmpty else { throw CustomStationValidationError.missingStreamURL }
    guard let streamURL = URL(string: streamValue), let streamScheme = streamURL.scheme?.lowercased(),
          streamURL.host != nil else {
        throw CustomStationValidationError.invalidStreamURL
    }
    guard ["http", "https"].contains(streamScheme) else {
        throw CustomStationValidationError.unsupportedStreamURLScheme
    }
    let secureStreamURL = streamScheme == "http" ? upgradedHTTPSURL(streamURL) : streamURL

    let homepage = try parseOptionalHTTPURL(rawHomepage)
    let country = rawCountry.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if !country.isEmpty, country.range(of: #"^[A-Z]{2}$"#, options: .regularExpression) == nil {
        throw CustomStationValidationError.invalidCountry
    }

    return Station(
        id: id,
        name: name,
        streamUrl: secureStreamURL,
        homepage: homepage,
        country: country.isEmpty ? nil : country,
        tags: parseCustomTags(rawTags),
        status: "stream-only",
    )
}

func canonicalStreamURL(_ url: URL) -> String {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return url.absoluteString
    }
    components.scheme = "https"
    components.host = components.host?.lowercased()
    components.fragment = nil
    components.queryItems = canonicalStreamQueryItems(components.queryItems)
    return components.url?.absoluteString ?? url.absoluteString
}

func streamURLExists(_ url: URL, in stations: [Station]) -> Bool {
    stations.contains { streamURLsMatch(url, $0.streamUrl) }
}

func stationsMatchingStreamURL(_ url: URL, in stations: [Station]) -> [Station] {
    stations.filter { streamURLsMatch(url, $0.streamUrl) }
}

func streamURLsMatch(_ lhs: URL, _ rhs: URL) -> Bool {
    canonicalStreamURL(lhs) == canonicalStreamURL(rhs)
}

private func canonicalStreamQueryItems(_ queryItems: [URLQueryItem]?) -> [URLQueryItem]? {
    guard let queryItems else { return nil }
    let stableItems = queryItems
        .filter { !isVolatileStreamQueryName($0.name) }
        .sorted {
            if $0.name == $1.name {
                return ($0.value ?? "") < ($1.value ?? "")
            }
            return $0.name < $1.name
        }
    return stableItems.isEmpty ? nil : stableItems
}

private func isVolatileStreamQueryName(_ name: String) -> Bool {
    let normalized = name.lowercased()
    return normalized.hasPrefix("_") ||
        [
            "cachebuster",
            "cachebust",
            "cb",
            "nocache",
            "t",
            "ts",
            "timestamp",
        ].contains(normalized)
}

private func upgradedHTTPSURL(_ url: URL) -> URL {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return url
    }
    components.scheme = "https"
    return components.url ?? url
}

private func parseOptionalHTTPURL(_ raw: String) throws -> URL? {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    guard let url = URL(string: value), let scheme = url.scheme?.lowercased(),
          ["http", "https"].contains(scheme), url.host != nil else {
        throw CustomStationValidationError.invalidHomepage
    }
    return url
}

private func parseCustomTags(_ raw: String) -> [String] {
    raw
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty }
}
