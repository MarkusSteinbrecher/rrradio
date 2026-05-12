import XCTest
@testable import rrradio

/// Search normalization + matching. Mirrors the web's `format.test.ts`
/// expectations so the iOS app's filter behaves the same as the
/// browser's. Audit #72.
final class SearchTests: XCTestCase {
    func testNormalizeKeepsAlphaAndDigits() {
        XCTAssertEqual(normalizeForSearch("WDR 5"), "wdr5")
        XCTAssertEqual(normalizeForSearch("NDR 90,3"), "ndr903")
    }

    func testNormalizeKeepsGermanDiacritics() {
        XCTAssertEqual(normalizeForSearch("Bayern Süd"), "bayernsüd")
        XCTAssertEqual(normalizeForSearch("Größe Straße"), "größestraße")
        XCTAssertEqual(normalizeForSearch("FÖJ Österreich"), "föjösterreich")
    }

    func testNormalizeDropsPunctuationAndWhitespace() {
        XCTAssertEqual(normalizeForSearch("HR 1!"), "hr1")
        XCTAssertEqual(normalizeForSearch("rock-antenne"), "rockantenne")
        XCTAssertEqual(normalizeForSearch("ORF / FM4"), "orffm4")
    }

    func testNormalizeOnEmptyAndPunctuationOnly() {
        XCTAssertEqual(normalizeForSearch(""), "")
        XCTAssertEqual(normalizeForSearch("!@#$%^"), "")
    }

    private func station(
        id: String = "x",
        name: String,
        streamUrl: URL = URL(string: "https://example.com/stream")!,
        broadcaster: String? = nil,
        homepage: URL? = nil,
        tags: [String]? = nil,
        country: String? = nil,
    ) -> Station {
        Station(
            id: id,
            name: name,
            streamUrl: streamUrl,
            broadcaster: broadcaster,
            homepage: homepage,
            country: country,
            tags: tags,
        )
    }

    func testEmptyQueryMatches() {
        XCTAssertTrue(stationMatches(station(name: "Anything"), query: ""))
        XCTAssertTrue(stationMatches(station(name: "Anything"), query: "   "))
    }

    func testSubstringMatchOnName() {
        XCTAssertTrue(stationMatches(station(name: "Radio Eins"), query: "eins"))
        XCTAssertTrue(stationMatches(station(name: "Radio Eins"), query: "RADIO"))
        XCTAssertTrue(stationMatches(station(name: "Kontrafunk"), query: "ontra"))
    }

    func testWhitespaceInsensitiveMatch() {
        // Mirrors the bug we fixed for "WDR5" → "WDR 5" on the web.
        XCTAssertTrue(stationMatches(station(name: "WDR 5"), query: "wdr5"))
        XCTAssertTrue(stationMatches(station(name: "NDR 90,3"), query: "ndr903"))
    }

    func testPunctuationInsensitiveStationNameMatch() {
        XCTAssertTrue(stationMatches(station(name: "_80-Station"), query: "80 Station"))
        XCTAssertTrue(stationMatches(station(name: "80 Station"), query: "_80-Station"))
    }

    func testTagMatch() {
        XCTAssertTrue(stationMatches(
            station(name: "Public", tags: ["jazz", "swing"]),
            query: "jazz",
        ))
    }

    func testPunctuationInsensitiveTagMatch() {
        XCTAssertTrue(stationMatches(
            station(name: "Public", tags: ["electro-pop"]),
            query: "electro pop",
        ))
    }

    func testCountryCodeMatch() {
        XCTAssertTrue(stationMatches(
            station(name: "Public", country: "DE"),
            query: "de",
        ))
    }

    func testBroadcasterAndUrlMatchCaseInsensitively() {
        let station = station(
            name: "B5 aktuell",
            streamUrl: URL(string: "http://streams.br.de/b5aktuell_2.m3u")!,
            broadcaster: "br",
            homepage: URL(string: "https://www.br.de/radio/br24/index.html")!,
            country: "DE",
        )

        XCTAssertTrue(stationMatches(station, query: "BR"))
        XCTAssertTrue(stationMatches(station, query: "br"))
    }

    func testNoMatch() {
        XCTAssertFalse(stationMatches(
            station(name: "BR Klassik", tags: ["classical"], country: "DE"),
            query: "jazz",
        ))
    }
}
