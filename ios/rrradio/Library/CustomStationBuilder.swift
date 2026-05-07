import Foundation

enum CustomStationValidationError: LocalizedError, Equatable {
    case missingName
    case missingStreamURL
    case invalidStreamURL
    case insecureStreamURL
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
        case .insecureStreamURL:
            return "Stream URL must use https://."
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
    guard streamScheme == "https" else {
        throw CustomStationValidationError.insecureStreamURL
    }

    let homepage = try parseOptionalHTTPURL(rawHomepage)
    let country = rawCountry.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if !country.isEmpty, country.range(of: #"^[A-Z]{2}$"#, options: .regularExpression) == nil {
        throw CustomStationValidationError.invalidCountry
    }

    return Station(
        id: id,
        name: name,
        streamUrl: streamURL,
        homepage: homepage,
        country: country.isEmpty ? nil : country,
        tags: parseCustomTags(rawTags),
        status: "stream-only",
    )
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
