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

    func testSaveAsFavoriteStationZeroInsertsOnlyNewStationsAtFront() {
        let library = Library(defaults: defaults)
        library.addFavorite(station("a"))
        library.addFavorite(station("b"))

        library.saveAsFavoriteStationZeroIfNeeded(station("x"))

        XCTAssertEqual(library.favorites.map(\.id), ["x", "b", "a"])

        library.saveAsFavoriteStationZeroIfNeeded(station("a", name: "Updated A"))

        XCTAssertEqual(library.favorites.map(\.id), ["x", "b", "a"])
        XCTAssertEqual(library.favorites[2].name, "Updated A")
    }

    func testFavoriteStepCyclesThroughOrderedFavorites() {
        let library = Library(defaults: defaults)
        library.addFavorite(station("a"))
        library.addFavorite(station("b"))
        library.addFavorite(station("c"))

        XCTAssertEqual(
            library.stationForFavoriteStep(from: station("b"), direction: .forward)?.id,
            "a",
        )
        XCTAssertEqual(
            library.stationForFavoriteStep(from: station("b"), direction: .backward)?.id,
            "c",
        )
        XCTAssertEqual(
            library.stationForFavoriteStep(from: station("a"), direction: .forward)?.id,
            "c",
        )
    }

    func testFavoriteStepAnchorsNonFavoriteAsStationZero() {
        let library = Library(defaults: defaults)
        library.addFavorite(station("a"))
        library.addFavorite(station("b"))

        let next = library.stationForFavoriteStep(from: station("x"), direction: .forward)

        XCTAssertEqual(next?.id, "b")
        XCTAssertEqual(library.favorites.map(\.id), ["x", "b", "a"])
    }

    func testFavoriteQueueInfoTreatsNonFavoriteCurrentAsStationZero() {
        let library = Library(defaults: defaults)
        library.addFavorite(station("a"))
        library.addFavorite(station("b"))

        XCTAssertEqual(
            library.favoriteQueueInfo(for: station("x")),
            FavoriteStationQueueInfo(index: 0, count: 3),
        )
        XCTAssertEqual(
            library.favoriteQueueInfo(for: station("a")),
            FavoriteStationQueueInfo(index: 1, count: 2),
        )
    }

    func testRefreshFavoritesUpdatesMatchingCatalogSnapshots() {
        let library = Library(defaults: defaults)
        library.toggleFavorite(station("fm4", name: "Old FM4"))
        library.toggleFavorite(station("custom", name: "Custom"))

        var catalogFM4 = station("fm4", name: "FM4")
        catalogFM4.favicon = URL(string: "https://example.com/fm4.png")
        catalogFM4.metadata = "orf"
        library.refreshFavorites(from: [catalogFM4])

        XCTAssertEqual(library.favorites.map(\.id), ["custom", "fm4"])
        XCTAssertEqual(library.favorites[1].name, "FM4")
        XCTAssertEqual(library.favorites[1].favicon, URL(string: "https://example.com/fm4.png"))
        XCTAssertEqual(library.favorites[1].metadata, "orf")
        XCTAssertEqual(library.favorites[0].name, "Custom")
    }

    func testAddCustomPersistsAcrossInstances() {
        let first = Library(defaults: defaults)
        first.addCustom(station("custom-a", name: "Custom A"))

        let second = Library(defaults: defaults)
        XCTAssertEqual(second.customStations.map(\.id), ["custom-a"])
        XCTAssertEqual(second.favorites.map(\.id), ["custom-a"])
        XCTAssertEqual(second.customStations.first?.name, "Custom A")
    }

    func testAddCustomReplacesMatchingId() {
        let library = Library(defaults: defaults)
        library.addCustom(station("custom-a", name: "Old"))
        library.addCustom(station("custom-a", name: "New"))

        XCTAssertEqual(library.customStations.count, 1)
        XCTAssertEqual(library.customStations.first?.name, "New")
        XCTAssertEqual(library.favorites.count, 1)
        XCTAssertEqual(library.favorites.first?.name, "New")
    }

    func testPreviouslyUnfavoritedCustomStationsAreRestoredAsFavorites() {
        let library = Library(defaults: defaults)
        library.addFavorite(station("catalog-a", name: "Catalog A"))
        library.addCustom(station("custom-a", name: "Custom A"), favorite: false)

        let restored = Library(defaults: defaults)

        XCTAssertEqual(restored.customStations.map(\.id), ["custom-a"])
        XCTAssertEqual(restored.favorites.map(\.id), ["custom-a", "catalog-a"])
        XCTAssertEqual(restored.favorites.first?.name, "Custom A")
    }

    func testCustomStationSaveFavoritesTheCustomStationItself() {
        let library = Library(defaults: defaults)
        library.addCustom(station("custom-a", name: "Custom A"), favorite: true)

        XCTAssertEqual(library.customStations.map(\.id), ["custom-a"])
        XCTAssertEqual(library.favorites.map(\.id), ["custom-a"])
        XCTAssertEqual(library.favorites.first?.name, "Custom A")
    }

    func testRemoveCustom() {
        let library = Library(defaults: defaults)
        library.addCustom(station("custom-a"))
        library.addCustom(station("custom-b"))

        library.removeCustom(id: "custom-a")

        XCTAssertEqual(library.customStations.map(\.id), ["custom-b"])
    }

    func testRemoveCustomAlsoRemovesSavedCopies() {
        let library = Library(defaults: defaults)
        let custom = station("custom-a")
        library.addCustom(custom)
        library.pushRecent(custom)

        library.removeCustom(id: "custom-a")

        XCTAssertTrue(library.customStations.isEmpty)
        XCTAssertTrue(library.favorites.isEmpty)
        XCTAssertTrue(library.recents.isEmpty)
    }

    func testUnfavoritingCustomStationRemovesCustomRecord() {
        let library = Library(defaults: defaults)
        let custom = station("custom-a")
        library.addCustom(custom)
        library.pushRecent(custom)

        XCTAssertFalse(library.toggleFavorite(custom))

        XCTAssertTrue(library.customStations.isEmpty)
        XCTAssertTrue(library.favorites.isEmpty)
        XCTAssertTrue(library.recents.isEmpty)
    }
}
