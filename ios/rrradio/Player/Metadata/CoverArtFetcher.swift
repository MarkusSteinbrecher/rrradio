import Foundation

private let coverArtCacheLimit = 64

private struct ITunesSearchResponse: Decodable {
    let resultCount: Int
    let results: [ITunesTrack]
}

private struct ITunesTrack: Decodable {
    let artistName: String
    let trackName: String
    let artworkUrl100: String?
    /// Apple's universal-link URL for the song, e.g.
    /// `https://music.apple.com/us/album/song-name/123?i=987`.
    /// Opening it via `UIApplication.open(_:)` deep-links to the
    /// Apple Music app when installed and falls back to the
    /// browser-based player otherwise — no MusicKit entitlement
    /// or auth required. Populated by every iTunes Search "song"
    /// entity hit; we keep it Optional defensively.
    let trackViewUrl: String?
}

/// Outcome of an iTunes Search call. `hit` mirrors `resultCount > 0`
/// and is the signal NowPlayingView uses to decide whether to surface
/// Apple Music / Spotify / YT Music buttons. `cover` is set only when
/// the best match also carries 100×100 artwork (which we upgrade to
/// 600×600 for retina rendering). `appleMusicUrl` is the deep link
/// to the exact song on the best match — when present, callers can
/// open Apple Music directly to the song rather than a search page.
public struct ITunesSearchResult: Equatable {
    public let hit: Bool
    public let cover: URL?
    public let appleMusicUrl: URL?

    public init(hit: Bool, cover: URL? = nil, appleMusicUrl: URL? = nil) {
        self.hit = hit
        self.cover = cover
        self.appleMusicUrl = appleMusicUrl
    }

    public static let miss = ITunesSearchResult(hit: false, cover: nil, appleMusicUrl: nil)
}

private actor ITunesSearchCache {
    static let shared = ITunesSearchCache()

    private var values: [String: ITunesSearchResult] = [:]
    private var order: [String] = []

    func value(for key: String) -> ITunesSearchResult? {
        values[key]
    }

    func set(_ value: ITunesSearchResult, for key: String) {
        if values[key] == nil {
            order.append(key)
        }
        values[key] = value

        while order.count > coverArtCacheLimit {
            let oldest = order.removeFirst()
            values.removeValue(forKey: oldest)
        }
    }
}

/// Run an iTunes Search and cache the outcome. Returns `.miss` on
/// transport errors *without* caching so the next poll can retry
/// (network blips don't poison the cache).
func searchITunes(
    artist: String?,
    title: String,
    fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async -> ITunesSearchResult {
    let cleanedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard cleanedTitle.count >= 3, cleanedTitle != "-", cleanedTitle != "—" else {
        return .miss
    }

    let key = coverArtCacheKey(artist: artist, title: cleanedTitle)
    if let cached = await ITunesSearchCache.shared.value(for: key) {
        return cached
    }

    guard let url = coverArtSearchURL(artist: artist, title: cleanedTitle) else {
        return .miss
    }
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 8

    do {
        let (data, response) = try await fetch(request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            // Treat as a miss for the duration of the cache — better
            // than re-hitting a flaky endpoint, and a real song will
            // resurface on a later track.
            await ITunesSearchCache.shared.set(.miss, for: key)
            return .miss
        }

        let decoded = try JSONDecoder().decode(ITunesSearchResponse.self, from: data)
        let hit = decoded.resultCount > 0
        let best = hit ? pickBestCoverArtMatch(decoded.results, artist: artist, title: cleanedTitle) : nil
        let cover = best?.artworkUrl100.flatMap(highResolutionITunesArtworkURL)
        let appleMusicUrl = best?.trackViewUrl.flatMap(URL.init(string:))
        let result = ITunesSearchResult(hit: hit, cover: cover, appleMusicUrl: appleMusicUrl)
        await ITunesSearchCache.shared.set(result, for: key)
        return result
    } catch {
        // Don't cache transient/aborted errors — let the next poll retry.
        return .miss
    }
}

/// Cover-art-only wrapper. Returns the high-res artwork URL on hit
/// (assuming the iTunes record carries one), `nil` otherwise.
func lookupCoverArt(
    artist: String?,
    title: String,
    fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async -> URL? {
    await searchITunes(artist: artist, title: title, fetch: fetch).cover
}

/// Existence-check wrapper. Returns whether iTunes has at least one
/// result for the given artist+title query. Drives the visibility of
/// Apple Music / Spotify / YT Music buttons in NowPlayingView — we
/// only surface them when iTunes confirms the title resolves to
/// something searchable. News/talk channels emit show names and
/// station IDs ("BR24 Aktuell", "Nachrichten 12:00 Uhr") that iTunes
/// won't match; those should NOT surface music-service buttons.
func verifyTrack(
    artist: String?,
    title: String,
    fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async -> Bool {
    await searchITunes(artist: artist, title: title, fetch: fetch).hit
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
