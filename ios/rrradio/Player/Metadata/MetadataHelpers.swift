import Foundation

func fetchMetadataJSON<T: Decodable>(
    _ type: T.Type,
    url: URL,
    fetch: MetadataDataFetcher,
) async throws -> T {
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await fetch(request)
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        throw URLError(.badServerResponse)
    }
    return try JSONDecoder().decode(type, from: data)
}

func fetchMetadataText(
    url: URL,
    fetch: MetadataDataFetcher,
) async throws -> String {
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await fetch(request)
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        throw URLError(.badServerResponse)
    }
    return String(decoding: data, as: UTF8.self)
}

func looseJSONData(from text: String) -> Data {
    guard let index = text.firstIndex(where: { $0 == "{" || $0 == "[" }) else {
        return Data(text.utf8)
    }
    return Data(text[index...].utf8)
}

func metadataTitleCase(_ value: String) -> String {
    let lowercased = value.lowercased()
    var output = ""
    var shouldUppercase = true

    for scalar in lowercased.unicodeScalars {
        let character = Character(scalar)
        if shouldUppercase, CharacterSet.letters.contains(scalar) {
            output.append(String(character).uppercased())
            shouldUppercase = false
        } else {
            output.append(character)
        }

        if scalar == " " || scalar == "\t" || scalar == "\n" || scalar == "'" || scalar == "’" || scalar == "-" || scalar == "/" {
            shouldUppercase = true
        } else if CharacterSet.letters.contains(scalar) || CharacterSet.decimalDigits.contains(scalar) {
            shouldUppercase = false
        }
    }

    return output
}

func metadataRaw(artist: String?, title: String) -> String {
    [artist, title]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: " - ")
}

func metadataStripHTML(_ input: String?) -> String? {
    guard let input else { return nil }
    let withoutTags = input.replacingOccurrences(
        of: "<[^>]*>",
        with: " ",
        options: .regularExpression,
    )
    let collapsed = withoutTags.replacingOccurrences(
        of: "\\s+",
        with: " ",
        options: .regularExpression,
    )
    let trimmed = collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

func metadataYYYYMMDD(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMdd"
    return formatter.string(from: date)
}
