import XCTest
@testable import rrradio

final class MusicServiceLinksTests: XCTestCase {
    func testBuildsSearchQueryFromArtistAndTitle() {
        XCTAssertEqual(
            musicSearchQuery(artist: "Radiohead", title: "Pyramid Song"),
            "Radiohead - Pyramid Song",
        )
    }

    func testBuildsSearchQueryFromTitleOnly() {
        XCTAssertEqual(
            musicSearchQuery(artist: nil, title: "Live stream title"),
            "Live stream title",
        )
    }

    func testSkipsEmptyTitle() {
        XCTAssertNil(musicSearchQuery(artist: "Artist", title: "  "))
        XCTAssertTrue(musicServiceLinks(artist: "Artist", title: nil).isEmpty)
    }

    func testBuildsMusicServiceURLs() {
        let links = musicServiceLinks(artist: "Björk", title: "Human Behaviour")
        XCTAssertEqual(links.map(\.id), ["apple-music", "spotify", "youtube-music"])

        XCTAssertEqual(
            links[0].url.absoluteString,
            "https://music.apple.com/search?term=Bj%C3%B6rk%20-%20Human%20Behaviour",
        )
        XCTAssertEqual(
            links[1].url.absoluteString,
            "https://open.spotify.com/search/Bj%C3%B6rk%20-%20Human%20Behaviour",
        )
        XCTAssertEqual(
            links[2].url.absoluteString,
            "https://music.youtube.com/search?q=Bj%C3%B6rk%20-%20Human%20Behaviour",
        )
    }

    func testUsesAppleMusicDeepLinkWhenProvided() {
        // When iTunes Search returned a trackViewUrl, the Apple Music
        // button opens the exact song instead of a generic search page.
        // Spotify + YT Music continue to fall back to search URLs —
        // neither has an unauthenticated direct-link path.
        let deepLink = URL(string: "https://music.apple.com/us/album/human-behaviour/123?i=987")!
        let links = musicServiceLinks(
            artist: "Björk",
            title: "Human Behaviour",
            appleMusicURL: deepLink,
        )
        XCTAssertEqual(links[0].id, "apple-music")
        XCTAssertEqual(links[0].url, deepLink)
        // Spotify + YT Music unchanged
        XCTAssertEqual(
            links[1].url.absoluteString,
            "https://open.spotify.com/search/Bj%C3%B6rk%20-%20Human%20Behaviour",
        )
        XCTAssertEqual(
            links[2].url.absoluteString,
            "https://music.youtube.com/search?q=Bj%C3%B6rk%20-%20Human%20Behaviour",
        )
    }

    func testFallsBackToSearchWhenAppleMusicURLIsNil() {
        // Explicit nil should behave identically to the default-arg case.
        let links = musicServiceLinks(
            artist: "Björk",
            title: "Human Behaviour",
            appleMusicURL: nil,
        )
        XCTAssertEqual(
            links[0].url.absoluteString,
            "https://music.apple.com/search?term=Bj%C3%B6rk%20-%20Human%20Behaviour",
        )
    }
}
