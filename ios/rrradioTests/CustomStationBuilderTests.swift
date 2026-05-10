import XCTest
@testable import rrradio

final class CustomStationBuilderTests: XCTestCase {
    func testBuildsStationFromValidFields() throws {
        let station = try makeCustomStation(
            name: "  Test FM  ",
            streamURL: "https://example.com/live",
            homepage: "https://example.com",
            country: "ch",
            tags: "Jazz, Indie, ",
            id: "custom-test",
        )

        XCTAssertEqual(station.id, "custom-test")
        XCTAssertEqual(station.name, "Test FM")
        XCTAssertEqual(station.streamUrl.absoluteString, "https://example.com/live")
        XCTAssertEqual(station.homepage?.absoluteString, "https://example.com")
        XCTAssertEqual(station.country, "CH")
        XCTAssertEqual(station.tags, ["jazz", "indie"])
        XCTAssertEqual(station.status, "stream-only")
    }

    func testRequiresName() {
        XCTAssertThrowsError(try makeCustomStation(name: "", streamURL: "https://example.com/live")) { error in
            XCTAssertEqual(error as? CustomStationValidationError, .missingName)
        }
    }

    func testRequiresStreamURL() {
        XCTAssertThrowsError(try makeCustomStation(name: "Test", streamURL: "")) { error in
            XCTAssertEqual(error as? CustomStationValidationError, .missingStreamURL)
        }
    }

    func testUpgradesHTTPStreamURLToHTTPS() throws {
        let station = try makeCustomStation(name: "Test", streamURL: "http://example.com/live")

        XCTAssertEqual(station.streamUrl.absoluteString, "https://example.com/live")
    }

    func testRejectsUnsupportedStreamURLScheme() {
        XCTAssertThrowsError(try makeCustomStation(name: "Test", streamURL: "ftp://example.com/live")) { error in
            XCTAssertEqual(error as? CustomStationValidationError, .unsupportedStreamURLScheme)
        }
    }

    func testCanonicalStreamURLMatchesHTTPAndHTTPS() throws {
        let existing = try makeCustomStation(
            name: "Existing",
            streamURL: "https://Example.com/live",
            id: "custom-existing",
        )
        let candidate = URL(string: "http://example.com/live")!

        XCTAssertTrue(streamURLExists(candidate, in: [existing]))
    }

    func testCanonicalStreamURLIgnoresVolatileQueryItems() throws {
        let existing = try makeCustomStation(
            name: "FM4",
            streamURL: "https://orf-live.ors-shoutcast.at/fm4-q2a",
            id: "builtin-fm4",
        )
        let candidate = URL(string: "https://orf-live.ors-shoutcast.at/fm4-q2a?_ic2=1778394866913")!

        XCTAssertTrue(streamURLExists(candidate, in: [existing]))
    }

    func testCanonicalStreamURLKeepsStableQueryItems() throws {
        let existing = try makeCustomStation(
            name: "Existing",
            streamURL: "https://example.com/live?mount=main",
            id: "custom-existing",
        )
        let candidate = URL(string: "https://example.com/live?mount=side&_ic2=1778394866913")!

        XCTAssertFalse(streamURLExists(candidate, in: [existing]))
    }

    func testFindsExistingStationsByCanonicalStreamURL() throws {
        let existing = try makeCustomStation(
            name: "Existing",
            streamURL: "https://Example.com/live",
            id: "custom-existing",
        )
        let unrelated = try makeCustomStation(
            name: "Unrelated",
            streamURL: "https://example.com/other",
            id: "custom-other",
        )
        let candidate = URL(string: "http://example.com/live")!

        XCTAssertEqual(stationsMatchingStreamURL(candidate, in: [unrelated, existing]), [existing])
    }

    func testRejectsInvalidHomepage() {
        XCTAssertThrowsError(
            try makeCustomStation(name: "Test", streamURL: "https://example.com/live", homepage: "ftp://example.com"),
        ) { error in
            XCTAssertEqual(error as? CustomStationValidationError, .invalidHomepage)
        }
    }

    func testRejectsInvalidCountry() {
        XCTAssertThrowsError(
            try makeCustomStation(name: "Test", streamURL: "https://example.com/live", country: "CHE"),
        ) { error in
            XCTAssertEqual(error as? CustomStationValidationError, .invalidCountry)
        }
    }
}
