import XCTest
@testable import rrradio

final class StationFiltersTests: XCTestCase {
    private func station(
        id: String = "x",
        name: String = "X",
        tags: [String]? = nil,
        country: String? = nil,
    ) -> Station {
        Station(
            id: id,
            name: name,
            streamUrl: URL(string: "https://example.com/\(id)")!,
            country: country,
            tags: tags,
        )
    }

    func testAvailableCountriesAreUniqueUppercaseAndSortedByDisplayName() {
        let result = availableCountries(from: [
            station(country: "de"),
            station(country: "AT"),
            station(country: "DE"),
            station(country: "bad"),
            station(country: nil),
        ], preferredCountry: nil)

        XCTAssertEqual(result, ["AT", "DE"])
    }

    func testAvailableCountriesMovesPreferredCountryToTop() {
        let result = availableCountries(from: [
            station(country: "DE"),
            station(country: "CH"),
            station(country: "AT"),
        ], preferredCountry: "ch")

        XCTAssertEqual(result, ["CH", "AT", "DE"])
    }

    func testDeviceRegionCodeUsesLocaleRegion() {
        let locale = Locale(identifier: "de_CH")

        XCTAssertEqual(deviceRegionCode(locale: locale), "CH")
    }

    func testAvailableTagsAreUniqueLowercaseAndSorted() {
        let result = availableTags(from: [
            station(tags: ["Jazz", " news "]),
            station(tags: ["jazz", "rock"]),
            station(tags: nil),
        ])

        XCTAssertEqual(result, ["jazz", "news", "rock"])
    }

    func testAvailableGenresComeFromStationTagsAndExcludeNews() {
        let result = availableGenres(from: [
            station(tags: ["Jazz", " new-rrradio-genre "]),
            station(tags: ["news", "ambient"]),
            station(tags: ["jazz"]),
        ])

        XCTAssertEqual(result, ["ambient", "jazz", "new-rrradio-genre"])
    }

    func testNoFiltersMatchesEveryStation() {
        XCTAssertTrue(stationMatchesFilters(station(tags: ["jazz"], country: "DE"), country: nil, tag: nil))
    }

    func testCountryFilterIsCaseInsensitive() {
        XCTAssertTrue(stationMatchesFilters(station(country: "de"), country: "DE", tag: nil))
        XCTAssertFalse(stationMatchesFilters(station(country: "AT"), country: "DE", tag: nil))
    }

    func testTagFilterIsCaseInsensitive() {
        XCTAssertTrue(stationMatchesFilters(station(tags: ["Jazz"]), country: nil, tag: "jazz"))
        XCTAssertFalse(stationMatchesFilters(station(tags: ["rock"]), country: nil, tag: "jazz"))
    }

    func testCombinesCountryAndTag() {
        XCTAssertTrue(stationMatchesFilters(station(tags: ["news"], country: "DE"), country: "DE", tag: "news"))
        XCTAssertFalse(stationMatchesFilters(station(tags: ["jazz"], country: "DE"), country: "DE", tag: "news"))
    }
}
