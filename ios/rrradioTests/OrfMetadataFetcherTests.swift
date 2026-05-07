import XCTest
@testable import rrradio

final class OrfMetadataFetcherTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func station(metadataUrl: String? = "https://audioapi.orf.at/fm4/api/json/4.0/live") -> Station {
        Station(
            id: "fm4",
            name: "FM4",
            streamUrl: URL(string: "https://example.com/fm4")!,
            metadataUrl: metadataUrl,
            metadata: "orf",
        )
    }

    private func response(for url: URL) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    func testFetchesCurrentMusicItem() async throws {
        let liveURL = URL(string: "https://audioapi.orf.at/fm4/api/json/4.0/live")!
        let detailURL = URL(string: "https://audioapi.orf.at/fm4/detail/current")!
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let broadcastStart = nowMs - 10_000
        let broadcastEnd = nowMs + 10_000
        let itemStart = nowMs - 1_000
        let live = """
        [
          {
            "start": \(broadcastStart),
            "end": \(broadcastEnd),
            "href": "\(detailURL.absoluteString)",
            "title": "FM4 Unlimited",
            "subtitle": "<p>with Functionist</p>"
          }
        ]
        """.data(using: .utf8)!
        let detail = """
        {
          "items": [
            {
              "type": "M",
              "start": \(itemStart),
              "duration": 5000,
              "title": "Song",
              "interpreter": "Artist",
              "images": [
                {
                  "versions": [
                    { "path": "https://images.example/small.jpg", "width": 200 },
                    { "path": "https://images.example/large.jpg", "width": 800 }
                  ]
                }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        let metadata = try await fetchOrfMetadata(station: station(), now: now) { request in
            switch request.url {
            case liveURL:
                return (live, self.response(for: liveURL))
            case detailURL:
                return (detail, self.response(for: detailURL))
            default:
                throw URLError(.badURL)
            }
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: "Artist",
            title: "Song",
            raw: "Artist - Song",
            programName: "FM4 Unlimited",
            programSubtitle: "with Functionist",
            coverUrl: URL(string: "https://images.example/large.jpg"),
        ))
    }

    func testReturnsNilWhenNoCurrentBroadcast() async throws {
        let liveURL = URL(string: "https://audioapi.orf.at/fm4/api/json/4.0/live")!
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let broadcastStart = nowMs - 20_000
        let broadcastEnd = nowMs - 10_000
        let live = """
        [
          {
            "start": \(broadcastStart),
            "end": \(broadcastEnd),
            "href": "https://audioapi.orf.at/fm4/detail/old"
          }
        ]
        """.data(using: .utf8)!

        let metadata = try await fetchOrfMetadata(station: station(), now: now) { request in
            XCTAssertEqual(request.url, liveURL)
            return (live, self.response(for: liveURL))
        }

        XCTAssertNil(metadata)
    }

    func testReturnsProgramForTalkItem() async throws {
        let liveURL = URL(string: "https://audioapi.orf.at/fm4/api/json/4.0/live")!
        let detailURL = URL(string: "https://audioapi.orf.at/fm4/detail/current")!
        let nowMs = Int(now.timeIntervalSince1970 * 1000)
        let broadcastStart = nowMs - 10_000
        let broadcastEnd = nowMs + 10_000
        let itemStart = nowMs - 1_000
        let live = """
        [{
          "start": \(broadcastStart),
          "end": \(broadcastEnd),
          "href": "\(detailURL.absoluteString)",
          "title": "FM4 Morning Show",
          "subtitle": "<p>with Stuart Freeman</p>"
        }]
        """.data(using: .utf8)!
        let detail = """
        { "items": [{ "type": "T", "start": \(itemStart), "duration": 5000, "title": "News" }] }
        """.data(using: .utf8)!

        let metadata = try await fetchOrfMetadata(station: station(), now: now) { request in
            if request.url == liveURL { return (live, self.response(for: liveURL)) }
            return (detail, self.response(for: detailURL))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "",
            programName: "FM4 Morning Show",
            programSubtitle: "with Stuart Freeman",
        ))
    }

    func testRegistryFindsOrfStations() {
        XCTAssertNotNil(metadataFetcher(for: station()))
        XCTAssertNotNil(metadataFetcher(for: station(metadataUrl: "https://audioapi.orf.at/oe1/api/json/4.0/live")))
        XCTAssertNotNil(metadataFetcher(for: Station(
            id: "at-fm4-orf",
            name: "FM4 | ORF",
            streamUrl: URL(string: "https://orf-live.ors-shoutcast.at/fm4-q1a")!,
        )))
    }
}
