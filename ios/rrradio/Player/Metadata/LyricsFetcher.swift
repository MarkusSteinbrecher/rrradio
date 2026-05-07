import Foundation

struct SyncedLyricsLine: Equatable, Identifiable {
    let timestamp: TimeInterval
    let text: String

    var id: String {
        "\(Int(timestamp * 1000))-\(text)"
    }
}

struct LyricsResult: Equatable {
    let plain: String?
    let synced: [SyncedLyricsLine]

    var displayText: String {
        if let plain, !plain.isEmpty {
            return plain
        }
        return synced.map(\.text).joined(separator: "\n")
    }

    var isEmpty: Bool {
        (plain?.isEmpty != false) && synced.isEmpty
    }
}

actor LyricsCache {
    static let shared = LyricsCache()

    private var values: [String: LyricsResult?] = [:]

    func value(for key: String) -> LyricsResult?? {
        values[key]
    }

    func setValue(_ value: LyricsResult?, for key: String) {
        values[key] = value
    }
}

private let lrclibURL = URL(string: "https://lrclib.net/api/get")!
private let lyricsOvhURL = URL(string: "https://api.lyrics.ovh/v1")!

func lyricsCacheKey(artist: String, track: String) -> String {
    "\(artist.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())::\(track.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
}

func parseLrcLyrics(_ lrc: String) -> [SyncedLyricsLine] {
    var output: [SyncedLyricsLine] = []
    let timestampPattern = #"^\[(\d+):(\d+)(?:\.(\d+))?\]"#
    let regex = try? NSRegularExpression(pattern: timestampPattern)

    for rawLine in lrc.components(separatedBy: .newlines) {
        var rest = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        var timestamps: [TimeInterval] = []

        while let regex,
              let match = regex.firstMatch(in: rest, range: NSRange(rest.startIndex..., in: rest)),
              match.range.location == 0,
              let minutesRange = Range(match.range(at: 1), in: rest),
              let secondsRange = Range(match.range(at: 2), in: rest) {
            let minutes = Double(rest[minutesRange]) ?? 0
            let seconds = Double(rest[secondsRange]) ?? 0
            var milliseconds = 0.0
            if let fractionRange = Range(match.range(at: 3), in: rest) {
                let rawFraction = String(rest[fractionRange])
                let padded = String((rawFraction + "000").prefix(3))
                milliseconds = (Double(padded) ?? 0) / 1000
            }
            timestamps.append(minutes * 60 + seconds + milliseconds)

            guard let fullRange = Range(match.range(at: 0), in: rest) else { break }
            rest = String(rest[fullRange.upperBound...])
        }

        let text = rest.trimmingCharacters(in: .whitespacesAndNewlines)
        for timestamp in timestamps {
            output.append(SyncedLyricsLine(timestamp: timestamp, text: text))
        }
    }

    return output.sorted { $0.timestamp < $1.timestamp }
}

func lookupLyrics(
    artist: String,
    track: String,
    fetch: @escaping MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
    cache: LyricsCache = .shared,
) async -> LyricsResult? {
    let key = lyricsCacheKey(artist: artist, track: track)
    if let cached = await cache.value(for: key) {
        return cached
    }

    let lrclib = await tryLrclibLyrics(artist: artist, track: track, fetch: fetch)
    if case .found(let lyrics) = lrclib {
        await cache.setValue(lyrics, for: key)
        return lyrics
    }

    if case .instrumental = lrclib {
        await cache.setValue(nil, for: key)
        return nil
    }

    let fallback = await tryLyricsOvh(artist: artist, track: track, fetch: fetch)
    await cache.setValue(fallback, for: key)
    return fallback
}

private struct LrclibResponse: Decodable {
    let plainLyrics: String?
    let syncedLyrics: String?
    let instrumental: Bool?
}

private struct LyricsOvhResponse: Decodable {
    let lyrics: String?
}

private enum LrclibAttempt {
    case found(LyricsResult)
    case instrumental
    case miss
}

private func lrclibRequest(artist: String, track: String) -> URLRequest? {
    var components = URLComponents(url: lrclibURL, resolvingAgainstBaseURL: false)
    components?.queryItems = [
        URLQueryItem(name: "artist_name", value: artist),
        URLQueryItem(name: "track_name", value: track),
    ]
    guard let url = components?.url else { return nil }
    return URLRequest(url: url)
}

private func tryLrclibLyrics(
    artist: String,
    track: String,
    fetch: MetadataDataFetcher,
) async -> LrclibAttempt {
    guard var request = lrclibRequest(artist: artist, track: track) else { return .miss }
    request.cachePolicy = .reloadIgnoringLocalCacheData

    do {
        let data = try await fetchLyricsData(request, fetch: fetch)
        let response = try JSONDecoder().decode(LrclibResponse.self, from: data)
        if response.instrumental == true { return .instrumental }

        let plain = response.plainLyrics?.trimmingCharacters(in: .whitespacesAndNewlines)
        let synced = response.syncedLyrics.map(parseLrcLyrics) ?? []
        let result = LyricsResult(
            plain: plain?.isEmpty == false ? plain : nil,
            synced: synced,
        )
        return result.isEmpty ? .miss : .found(result)
    } catch {
        return .miss
    }
}

private func tryLyricsOvh(
    artist: String,
    track: String,
    fetch: MetadataDataFetcher,
) async -> LyricsResult? {
    let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
    let encodedArtist = artist.addingPercentEncoding(withAllowedCharacters: allowed) ?? artist
    let encodedTrack = track.addingPercentEncoding(withAllowedCharacters: allowed) ?? track
    guard let url = URL(string: "\(lyricsOvhURL.absoluteString)/\(encodedArtist)/\(encodedTrack)") else {
        return nil
    }
    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData

    do {
        let data = try await fetchLyricsData(request, fetch: fetch)
        let response = try JSONDecoder().decode(LyricsOvhResponse.self, from: data)
        let plain = response.lyrics?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let plain, !plain.isEmpty else { return nil }
        return LyricsResult(plain: plain, synced: [])
    } catch {
        return nil
    }
}

private func fetchLyricsData(
    _ request: URLRequest,
    fetch: MetadataDataFetcher,
) async throws -> Data {
    let (data, response) = try await fetch(request)
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        throw URLError(.badServerResponse)
    }
    return data
}
