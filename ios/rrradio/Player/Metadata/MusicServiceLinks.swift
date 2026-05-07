import Foundation

struct MusicServiceLink: Identifiable, Equatable {
    let id: String
    let title: String
    let imageName: String
    let url: URL
}

func musicSearchQuery(artist: String?, title: String?) -> String? {
    guard let cleanTitle = cleanMusicSearchComponent(title) else { return nil }
    guard let cleanArtist = cleanMusicSearchComponent(artist) else { return cleanTitle }
    return "\(cleanArtist) - \(cleanTitle)"
}

func musicServiceLinks(artist: String?, title: String?) -> [MusicServiceLink] {
    guard let query = musicSearchQuery(artist: artist, title: title) else { return [] }
    return [
        MusicServiceLink(
            id: "apple-music",
            title: "Apple Music",
            imageName: "AppleMusicIcon",
            url: appleMusicSearchURL(query),
        ),
        MusicServiceLink(
            id: "spotify",
            title: "Spotify",
            imageName: "SpotifyIcon",
            url: spotifySearchURL(query),
        ),
        MusicServiceLink(
            id: "youtube-music",
            title: "YouTube Music",
            imageName: "YouTubeMusicIcon",
            url: youtubeMusicSearchURL(query),
        ),
    ]
}

private func cleanMusicSearchComponent(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed?.isEmpty == false ? trimmed : nil
}

private func appleMusicSearchURL(_ query: String) -> URL {
    var components = URLComponents(string: "https://music.apple.com/search")!
    components.queryItems = [URLQueryItem(name: "term", value: query)]
    return components.url!
}

private func spotifySearchURL(_ query: String) -> URL {
    let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))
    let encoded = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? query
    return URL(string: "https://open.spotify.com/search/\(encoded)")!
}

private func youtubeMusicSearchURL(_ query: String) -> URL {
    var components = URLComponents(string: "https://music.youtube.com/search")!
    components.queryItems = [URLQueryItem(name: "q", value: query)]
    return components.url!
}
