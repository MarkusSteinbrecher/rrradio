import XCTest
@testable import rrradio

final class CoverArtFetcherTests: XCTestCase {
    private func response(for url: URL, statusCode: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    private func hitPayload(artist: String, title: String, artwork: String) -> Data {
        """
        {
          "resultCount": 1,
          "results": [
            {
              "artistName": "\(artist)",
              "trackName": "\(title)",
              "artworkUrl100": "\(artwork)"
            }
          ]
        }
        """.data(using: .utf8)!
    }

    private var missPayload: Data {
        """
        { "resultCount": 0, "results": [] }
        """.data(using: .utf8)!
    }

    func testLooksUpHighResolutionITunesArtwork() async throws {
        let artwork = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/example/100x100bb.jpg"
        let payload = hitPayload(artist: "The Artist A", title: "The Song A", artwork: artwork)

        let cover = await lookupCoverArt(artist: "The Artist A", title: "The Song A") { request in
            XCTAssertEqual(request.url?.host, "itunes.apple.com")
            XCTAssertTrue(request.url?.query?.contains("entity=song") == true)
            return (payload, self.response(for: request.url!))
        }

        XCTAssertEqual(cover?.absoluteString, "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/example/600x600bb.jpg")
    }

    func testDetectsKnownLowResolutionStationCovers() {
        XCTAssertTrue(isLowResolutionCoverURL(URL(string: "https://example.com/Medias/Covers/m/cover.jpg")!))
        XCTAssertTrue(isLowResolutionCoverURL(URL(string: "https://cdne-satr-prd-rsp-covers.azureedge.net/50/abc.jpg")!))
        XCTAssertFalse(isLowResolutionCoverURL(URL(string: "https://example.com/600x600bb.jpg")!))
    }

    // MARK: - searchITunes / verifyTrack

    func testSearchITunesReturnsHitAndUpgradedCover() async {
        let artwork = "https://is1-ssl.mzstatic.com/image/thumb/Music456/v4/100x100bb.jpg"
        let payload = hitPayload(artist: "Radiohead B", title: "Pyramid Song B", artwork: artwork)
        let result = await searchITunes(artist: "Radiohead B", title: "Pyramid Song B") { request in
            (payload, self.response(for: request.url!))
        }
        XCTAssertTrue(result.hit)
        XCTAssertEqual(result.cover?.absoluteString, "https://is1-ssl.mzstatic.com/image/thumb/Music456/v4/600x600bb.jpg")
    }

    func testSearchITunesReturnsMissOnResultCountZero() async {
        let result = await searchITunes(artist: nil, title: "BR24 Aktuell C") { request in
            (self.missPayload, self.response(for: request.url!))
        }
        XCTAssertFalse(result.hit)
        XCTAssertNil(result.cover)
    }

    func testSearchITunesSkipsShortAndDashTitles() async {
        let resultEmDash = await searchITunes(artist: nil, title: "—") { _ in
            XCTFail("network should not be hit for em-dash title")
            return (Data(), HTTPURLResponse())
        }
        XCTAssertFalse(resultEmDash.hit)

        let resultShort = await searchITunes(artist: nil, title: "ab") { _ in
            XCTFail("network should not be hit for <3-char title")
            return (Data(), HTTPURLResponse())
        }
        XCTAssertFalse(resultShort.hit)
    }

    func testSearchITunesCachesHitAcrossCalls() async {
        let payload = hitPayload(
            artist: "Cached Artist D",
            title: "Cached Title D",
            artwork: "https://is1-ssl.mzstatic.com/image/thumb/D/100x100bb.jpg",
        )
        var calls = 0
        let fetch: MetadataDataFetcher = { request in
            calls += 1
            return (payload, self.response(for: request.url!))
        }
        let first = await searchITunes(artist: "Cached Artist D", title: "Cached Title D", fetch: fetch)
        let second = await searchITunes(artist: "Cached Artist D", title: "Cached Title D", fetch: fetch)
        XCTAssertEqual(first, second)
        XCTAssertEqual(calls, 1)
    }

    func testSearchITunesCachesMissAcrossCalls() async {
        var calls = 0
        let fetch: MetadataDataFetcher = { request in
            calls += 1
            return (self.missPayload, self.response(for: request.url!))
        }
        let first = await searchITunes(artist: nil, title: "Cached News E", fetch: fetch)
        let second = await searchITunes(artist: nil, title: "Cached News E", fetch: fetch)
        XCTAssertFalse(first.hit)
        XCTAssertFalse(second.hit)
        XCTAssertEqual(calls, 1)
    }

    func testVerifyTrackReturnsTrueOnHitAndFalseOnMiss() async {
        let hit = await verifyTrack(
            artist: "Radiohead F",
            title: "Pyramid Song F",
        ) { request in
            (
                self.hitPayload(
                    artist: "Radiohead F",
                    title: "Pyramid Song F",
                    artwork: "https://is1-ssl.mzstatic.com/image/thumb/F/100x100bb.jpg",
                ),
                self.response(for: request.url!),
            )
        }
        XCTAssertTrue(hit)

        let miss = await verifyTrack(artist: nil, title: "Nachrichten G") { request in
            (self.missPayload, self.response(for: request.url!))
        }
        XCTAssertFalse(miss)
    }
}
