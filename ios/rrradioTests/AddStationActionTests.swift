import XCTest
@testable import rrradio

final class AddStationActionTests: XCTestCase {
    func testCatalogSubmissionMailURLBuildsPrefilledMailto() throws {
        let url = try XCTUnwrap(catalogSubmissionMailURL(
            name: "  Test FM  ",
            streamURL: " https://example.com/live ",
        ))

        XCTAssertEqual(url.scheme, "mailto")
        XCTAssertEqual(url.path, "redsukramst@gmail.com")

        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })

        XCTAssertEqual(query["subject"], "rrradio catalog station request")
        XCTAssertTrue(query["body"]?.contains("Name: Test FM") == true)
        XCTAssertTrue(query["body"]?.contains("Stream URL: https://example.com/live") == true)
    }

    func testCatalogSubmissionMailURLRequiresStreamURL() {
        XCTAssertNil(catalogSubmissionMailURL(name: "Test FM", streamURL: " "))
    }

    func testNormalizesBareStreamURLToHTTPS() {
        XCTAssertEqual(normalizedHTTPSStreamURLString(" example.com/live "), "https://example.com/live")
    }

    func testUpgradesHTTPStreamURLToHTTPS() {
        XCTAssertEqual(normalizedHTTPSStreamURLString("http://example.com/live"), "https://example.com/live")
    }

    func testCollapsesDuplicateHTTPSStreamURLScheme() {
        XCTAssertEqual(normalizedHTTPSStreamURLString("https://https://example.com/live"), "https://example.com/live")
    }

    func testCollapsesMixedDuplicateWebStreamURLSchemes() {
        XCTAssertEqual(normalizedHTTPSStreamURLString("http://https://example.com/live"), "https://example.com/live")
    }

    func testKeepsUnsupportedExplicitSchemeForValidation() {
        XCTAssertEqual(normalizedHTTPSStreamURLString("ftp://example.com/live"), "ftp://example.com/live")
    }
}
