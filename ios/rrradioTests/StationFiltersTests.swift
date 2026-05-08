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

    func testGenreTaxonomyHasCanonicalEntries() {
        XCTAssertEqual(genres.count, 22)
        XCTAssertEqual(Set(genres.map(\.id)).count, genres.count)
        XCTAssertEqual(findGenre("rock")?.label, "Rock")
        XCTAssertEqual(findGenre("hiphop")?.rbTag, "hip hop")
        XCTAssertNil(findGenre("all"))
        XCTAssertNil(findGenre(nil))
        XCTAssertNil(findGenre("not-a-genre"))
    }

    func testAvailableGenresComeFromTaxonomyAndExcludeNews() {
        let result = availableGenres(from: [
            station(tags: ["classic rock"]),
            station(tags: ["news"]),
            station(tags: ["chillout"]),
        ])

        XCTAssertEqual(result.map(\.id), ["rock", "ambient"])
    }

    func testStationMatchesGenreWithSynonymsAndSubstrings() {
        XCTAssertTrue(stationMatchesGenre(station(tags: ["classic rock"]), genre: findGenre("rock")!))
        XCTAssertTrue(stationMatchesGenre(station(tags: ["hip-hop"]), genre: findGenre("hiphop")!))
        XCTAssertTrue(stationMatchesGenre(station(tags: ["80s"]), genre: findGenre("oldies")!))
        XCTAssertTrue(stationMatchesGenre(station(tags: ["noticias"]), genre: findGenre("latin")!))
        XCTAssertTrue(stationMatchesGenre(station(tags: ["lounge"]), genre: findGenre("ambient")!))
        XCTAssertFalse(stationMatchesGenre(station(tags: nil), genre: findGenre("rock")!))
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

    func testGenreFilterUsesTaxonomyMatching() {
        XCTAssertTrue(stationMatchesFilters(station(tags: ["classic rock"]), country: nil, tag: "rock"))
        XCTAssertTrue(stationMatchesFilters(station(tags: ["rap"]), country: nil, tag: "hiphop"))
        XCTAssertFalse(stationMatchesFilters(station(tags: ["classical"]), country: nil, tag: "rock"))
    }

    func testCombinesCountryAndTag() {
        XCTAssertTrue(stationMatchesFilters(station(tags: ["news"], country: "DE"), country: "DE", tag: "news"))
        XCTAssertFalse(stationMatchesFilters(station(tags: ["jazz"], country: "DE"), country: "DE", tag: "news"))
    }
}
