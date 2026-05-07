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
}
