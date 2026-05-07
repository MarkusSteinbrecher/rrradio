import XCTest
@testable import rrradio

final class LyricsFetcherTests: XCTestCase {
    private func response(for url: URL, status: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    func testParsesSyncedLyrics() {
        let lines = parseLrcLyrics("""
        [00:01.25][00:02.50] Hello
        [01:03] World
        no timestamp
        """)

        XCTAssertEqual(lines.count, 3)
        XCTAssertEqual(lines.map(\.text), ["Hello", "Hello", "World"])
        XCTAssertEqual(lines.map(\.timestamp), [1.25, 2.5, 63.0])
    }

    func testFetchesLrclibLyrics() async {
        let body = """
        {
          "plainLyrics": "Line one\\nLine two",
          "syncedLyrics": "[00:01.00] Line one\\n[00:02.00] Line two"
        }
        """.data(using: .utf8)!

        let lyrics = await lookupLyrics(artist: "Artist", track: "Track", fetch: { request in
            XCTAssertEqual(request.url?.host, "lrclib.net")
            return (body, self.response(for: request.url!))
        }, cache: LyricsCache())

        XCTAssertEqual(lyrics?.plain, "Line one\nLine two")
        XCTAssertEqual(lyrics?.synced.count, 2)
    }

    func testFallsBackToLyricsOvh() async {
        var hosts: [String] = []

        let lyrics = await lookupLyrics(artist: "Artist Name", track: "Track/Name", fetch: { request in
            hosts.append(request.url?.host ?? "")
            if request.url?.host == "lrclib.net" {
                return (Data(), self.response(for: request.url!, status: 404))
            }
            XCTAssertEqual(request.url?.host, "api.lyrics.ovh")
            XCTAssertTrue(request.url?.absoluteString.contains("Track%2FName") == true)
            let body = #"{"lyrics":"Fallback lyrics"}"#.data(using: .utf8)!
            return (body, self.response(for: request.url!))
        }, cache: LyricsCache())

        XCTAssertEqual(hosts, ["lrclib.net", "api.lyrics.ovh"])
        XCTAssertEqual(lyrics?.plain, "Fallback lyrics")
    }

    func testInstrumentalSkipsFallback() async {
        var requestCount = 0
        let body = #"{"instrumental":true}"#.data(using: .utf8)!

        let lyrics = await lookupLyrics(artist: "Artist", track: "Instrumental", fetch: { request in
            requestCount += 1
            return (body, self.response(for: request.url!))
        }, cache: LyricsCache())

        XCTAssertNil(lyrics)
        XCTAssertEqual(requestCount, 1)
    }

    func testCachesMisses() async {
        let cache = LyricsCache()
        var requestCount = 0

        for _ in 0..<2 {
            let lyrics = await lookupLyrics(artist: "Missing", track: "Song", fetch: { request in
                requestCount += 1
                return (Data(), self.response(for: request.url!, status: 404))
            }, cache: cache)
            XCTAssertNil(lyrics)
        }

        XCTAssertEqual(requestCount, 2)
    }
}
