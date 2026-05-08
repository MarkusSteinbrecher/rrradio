import XCTest
@testable import rrradio

final class CoverArtFetcherTests: XCTestCase {
    private func response(for url: URL, statusCode: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    func testLooksUpHighResolutionITunesArtwork() async throws {
        let artwork = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/example/100x100bb.jpg"
        let payload = """
        {
          "resultCount": 1,
          "results": [
            {
              "artistName": "The Artist",
              "trackName": "The Song",
              "artworkUrl100": "\(artwork)"
            }
          ]
        }
        """.data(using: .utf8)!

        let cover = await lookupCoverArt(artist: "The Artist", title: "The Song") { request in
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
}
