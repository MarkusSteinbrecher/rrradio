import XCTest
@testable import rrradio

final class ScheduleFetcherTests: XCTestCase {
    private func station(
        id: String = "builtin-fm4",
        metadataUrl: String? = "https://audioapi.orf.at/fm4/api/json/4.0/live",
        metadata: String? = "orf",
        streamUrl: String = "https://orf-live.ors-shoutcast.at/fm4-q2a",
    ) -> Station {
        Station(
            id: id,
            name: "FM4",
            streamUrl: URL(string: streamUrl)!,
            metadataUrl: metadataUrl,
            metadata: metadata,
        )
    }

    private func response(for url: URL) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    func testFetchesOrfDailySchedule() async throws {
        let scheduleURL = URL(string: "https://audioapi.orf.at/fm4/api/json/4.0/broadcasts")!
        let body = """
        [
          {
            "date": 1700000000000,
            "broadcasts": [
              {
                "start": 1700000000000,
                "end": 1700003600000,
                "title": "FM4 Morning Show",
                "subtitle": "<p>with Stuart Freeman</p>"
              },
              {
                "start": 1700003600000,
                "end": 1700007200000,
                "title": "FM4 Unlimited"
              }
            ]
          }
        ]
        """.data(using: .utf8)!

        let days = try await fetchOrfSchedule(station: station()) { request in
            XCTAssertEqual(request.url, scheduleURL)
            return (body, self.response(for: scheduleURL))
        }

        XCTAssertEqual(days?.count, 1)
        XCTAssertEqual(days?.first?.broadcasts.count, 2)
        XCTAssertEqual(days?.first?.broadcasts.first?.title, "FM4 Morning Show")
        XCTAssertEqual(days?.first?.broadcasts.first?.subtitle, "with Stuart Freeman")
    }

    func testScheduleRegistryFindsAlternateFm4StreamEntry() async throws {
        let fallbackStation = station(
            id: "at-fm4-orf",
            metadataUrl: nil,
            metadata: nil,
            streamUrl: "https://orf-live.ors-shoutcast.at/fm4-q1a",
        )

        XCTAssertNotNil(scheduleFetcher(for: fallbackStation))
    }
}
