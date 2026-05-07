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

    func testRejectsHTTPStreamURL() {
        XCTAssertThrowsError(try makeCustomStation(name: "Test", streamURL: "http://example.com/live")) { error in
            XCTAssertEqual(error as? CustomStationValidationError, .insecureStreamURL)
        }
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
