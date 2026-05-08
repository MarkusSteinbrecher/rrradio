import Foundation

private let coverArtCacheLimit = 64

private struct ITunesSearchResponse: Decodable {
    let results: [ITunesTrack]
}

private struct ITunesTrack: Decodable {
    let artistName: String
    let trackName: String
    let artworkUrl100: String?
}

private actor CoverArtCache {
    static let shared = CoverArtCache()

    private var values: [String: URL?] = [:]
    private var order: [String] = []

    func value(for key: String) -> URL?? {
        guard values.keys.contains(key) else { return nil }
        return values[key]
    }

    func set(_ value: URL?, for key: String) {
        if !values.keys.contains(key) {
            order.append(key)
        }
        values[key] = value

        while order.count > coverArtCacheLimit {
            let oldest = order.removeFirst()
            values.removeValue(forKey: oldest)
        }
    }
}

func lookupCoverArt(
    artist: String?,
    title: String,
    fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async -> URL? {
    let cleanedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard cleanedTitle.count >= 3, cleanedTitle != "-", cleanedTitle != "—" else { return nil }

    let key = coverArtCacheKey(artist: artist, title: cleanedTitle)
    if let cached = await CoverArtCache.shared.value(for: key) {
        return cached
    }

    guard let url = coverArtSearchURL(artist: artist, title: cleanedTitle) else { return nil }
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 8

    do {
        let (data, response) = try await fetch(request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            await CoverArtCache.shared.set(nil, for: key)
            return nil
        }

        let decoded = try JSONDecoder().decode(ITunesSearchResponse.self, from: data)
        let best = pickBestCoverArtMatch(decoded.results, artist: artist, title: cleanedTitle)
        let cover = best?.artworkUrl100.flatMap(highResolutionITunesArtworkURL)
        await CoverArtCache.shared.set(cover, for: key)
        return cover
    } catch {
        return nil
    }
}

func isLowResolutionCoverURL(_ url: URL) -> Bool {
    let value = url.absoluteString.lowercased()
    return value.contains("/medias/covers/m/") || value.contains("/50/")
}

private func coverArtCacheKey(artist: String?, title: String) -> String {
    "\((artist ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines))|\(title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines))"
}

private func coverArtSearchURL(artist: String?, title: String) -> URL? {
    var components = URLComponents(string: "https://itunes.apple.com/search")
    components?.queryItems = [
        URLQueryItem(name: "term", value: [artist, title].compactMap { $0 }.joined(separator: " ").prefixString(100)),
        URLQueryItem(name: "entity", value: "song"),
        URLQueryItem(name: "limit", value: "5"),
        URLQueryItem(name: "media", value: "music"),
    ]
    return components?.url
}

private func pickBestCoverArtMatch(_ results: [ITunesTrack], artist: String?, title: String) -> ITunesTrack? {
    guard !results.isEmpty else { return nil }

    let normalizedArtist = artist?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let normalizedTitle = title.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

    let exact = results.first { result in
        let resultArtist = result.artistName.lowercased()
        let resultTitle = result.trackName.lowercased()
        let artistMatches = normalizedArtist.isEmpty || resultArtist.contains(normalizedArtist) || normalizedArtist.contains(resultArtist)
        return resultTitle.contains(normalizedTitle) && artistMatches
    }

    return exact ?? results.first
}

private func highResolutionITunesArtworkURL(_ value: String) -> URL? {
    let upgraded = value.replacingOccurrences(
        of: #"/\d+x\d+bb\.(jpg|jpeg|png)"#,
        with: "/600x600bb.$1",
        options: [.regularExpression, .caseInsensitive],
    )
    return URL(string: upgraded)
}

private extension String {
    func prefixString(_ maxLength: Int) -> String {
        String(prefix(maxLength))
    }
}
