import XCTest
@testable import rrradio

/// Verifies that the iOS Station / CatalogResponse model decodes the
/// shape we publish at `https://rrradio.org/stations.json`. The web
/// build emits more fields than we use; decoding must skip unknowns
/// gracefully (default JSONDecoder behavior — extra keys are ignored).
final class CatalogDecodingTests: XCTestCase {
    func testDecodesMinimalStation() throws {
        let json = """
        {
          "stations": [
            {
              "id": "test-fm",
              "name": "Test FM",
              "streamUrl": "https://example.com/stream"
            }
          ]
        }
        """.data(using: .utf8)!
        let resp = try JSONDecoder().decode(CatalogResponse.self, from: json)
        XCTAssertEqual(resp.stations.count, 1)
        XCTAssertEqual(resp.stations[0].id, "test-fm")
        XCTAssertEqual(resp.stations[0].name, "Test FM")
        XCTAssertEqual(resp.stations[0].streamUrl.absoluteString, "https://example.com/stream")
    }

    func testDecodesAllOptionalFields() throws {
        let json = """
        {
          "stations": [
            {
              "id": "fm4",
              "name": "FM4",
              "streamUrl": "https://orf-live.ors-shoutcast.at/fm4-q2a",
              "homepage": "https://fm4.orf.at",
              "country": "AT",
              "tags": ["alternative", "indie"],
              "favicon": "https://example.com/fm4.png",
              "bitrate": 192,
              "codec": "AAC",
              "listeners": 0,
              "metadataUrl": "https://audioapi.orf.at/fm4/api/json/4.0/live",
              "metadata": "orf",
              "status": "working",
              "geo": [48.20, 16.37],
              "featured": true
            }
          ]
        }
        """.data(using: .utf8)!
        let resp = try JSONDecoder().decode(CatalogResponse.self, from: json)
        let s = try XCTUnwrap(resp.stations.first)
        XCTAssertEqual(s.country, "AT")
        XCTAssertEqual(s.tags, ["alternative", "indie"])
        XCTAssertEqual(s.bitrate, 192)
        XCTAssertEqual(s.codec, "AAC")
        XCTAssertEqual(s.metadata, "orf")
        XCTAssertEqual(s.metadataUrl, "https://audioapi.orf.at/fm4/api/json/4.0/live")
        XCTAssertEqual(s.geo, [48.20, 16.37])
        XCTAssertEqual(s.featured, true)
        XCTAssertEqual(s.status, "working")
    }

    func testIgnoresUnknownTopLevelAndStationKeys() throws {
        // Build artifacts include a `$schema` ref + a future-friendly
        // `broadcaster` field on each station. Decoding must skip both.
        let json = """
        {
          "$schema": "stations.schema.json",
          "stations": [
            {
              "id": "x",
              "name": "X",
              "streamUrl": "https://example.com/",
              "broadcaster": "future-field-we-dont-use",
              "httpAllowed": true
            }
          ]
        }
        """.data(using: .utf8)!
        XCTAssertNoThrow(try JSONDecoder().decode(CatalogResponse.self, from: json))
    }

    func testDecodesEmptyCatalog() throws {
        let json = #"{ "stations": [] }"#.data(using: .utf8)!
        let resp = try JSONDecoder().decode(CatalogResponse.self, from: json)
        XCTAssertTrue(resp.stations.isEmpty)
    }

    func testRejectsInvalidStreamUrl() {
        // Empty string isn't a valid URL — decoding should throw.
        let json = """
        { "stations": [{ "id": "x", "name": "X", "streamUrl": "" }] }
        """.data(using: .utf8)!
        XCTAssertThrowsError(try JSONDecoder().decode(CatalogResponse.self, from: json))
    }
}
