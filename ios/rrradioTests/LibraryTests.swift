import XCTest
@testable import rrradio

@MainActor
final class LibraryTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "rrradio-library-tests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    private func station(_ id: String, name: String? = nil) -> Station {
        Station(
            id: id,
            name: name ?? id.uppercased(),
            streamUrl: URL(string: "https://example.com/\(id)")!,
            country: "DE",
            tags: ["test"],
        )
    }

    func testStartsEmpty() {
        let library = Library(defaults: defaults)
        XCTAssertTrue(library.favorites.isEmpty)
        XCTAssertTrue(library.recents.isEmpty)
        XCTAssertTrue(library.customStations.isEmpty)
    }

    func testToggleFavoriteAddsAndRemoves() {
        let library = Library(defaults: defaults)
        let fm4 = station("fm4", name: "FM4")

        XCTAssertTrue(library.toggleFavorite(fm4))
        XCTAssertTrue(library.isFavorite(fm4))
        XCTAssertEqual(library.favorites.map(\.id), ["fm4"])

        XCTAssertFalse(library.toggleFavorite(fm4))
        XCTAssertFalse(library.isFavorite(fm4))
        XCTAssertTrue(library.favorites.isEmpty)
    }

    func testFavoritesPersistAcrossInstances() {
        let first = Library(defaults: defaults)
        first.toggleFavorite(station("fm4", name: "FM4"))

        let second = Library(defaults: defaults)
        XCTAssertEqual(second.favorites.map(\.id), ["fm4"])
        XCTAssertEqual(second.favorites.first?.name, "FM4")
    }

    func testPushRecentDedupesAndMovesToFront() {
        let library = Library(defaults: defaults)
        library.pushRecent(station("a"))
        library.pushRecent(station("b"))
        library.pushRecent(station("a"))

        XCTAssertEqual(library.recents.map(\.id), ["a", "b"])
    }

    func testRecentsAreLimited() {
        let library = Library(defaults: defaults)
        for i in 0..<(Library.recentsLimit + 3) {
            library.pushRecent(station("s\(i)"))
        }

        XCTAssertEqual(library.recents.count, Library.recentsLimit)
        XCTAssertEqual(library.recents.first?.id, "s14")
        XCTAssertEqual(library.recents.last?.id, "s3")
    }

    func testReorderFavoritesDropsUnknownIdsAndKeepsMissedStations() {
        let library = Library(defaults: defaults)
        library.toggleFavorite(station("a"))
        library.toggleFavorite(station("b"))
        library.toggleFavorite(station("c"))

        library.reorderFavorites(["a", "missing", "c"])

        XCTAssertEqual(library.favorites.map(\.id), ["a", "c", "b"])
    }

    func testAddCustomPersistsAcrossInstances() {
        let first = Library(defaults: defaults)
        first.addCustom(station("custom-a", name: "Custom A"))

        let second = Library(defaults: defaults)
        XCTAssertEqual(second.customStations.map(\.id), ["custom-a"])
        XCTAssertEqual(second.customStations.first?.name, "Custom A")
    }

    func testAddCustomReplacesMatchingId() {
        let library = Library(defaults: defaults)
        library.addCustom(station("custom-a", name: "Old"))
        library.addCustom(station("custom-a", name: "New"))

        XCTAssertEqual(library.customStations.count, 1)
        XCTAssertEqual(library.customStations.first?.name, "New")
    }

    func testRemoveCustom() {
        let library = Library(defaults: defaults)
        library.addCustom(station("custom-a"))
        library.addCustom(station("custom-b"))

        library.removeCustom(id: "custom-a")

        XCTAssertEqual(library.customStations.map(\.id), ["custom-b"])
    }
}
