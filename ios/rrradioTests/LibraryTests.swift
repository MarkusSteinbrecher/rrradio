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
        XCTAssertTrue(library.stationLists.isEmpty)
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

    func testReorderFavoritesKeepsMultipleMissedStationsInOriginalOrder() {
        let library = Library(defaults: defaults)
        library.toggleFavorite(station("a"))
        library.toggleFavorite(station("b"))
        library.toggleFavorite(station("c"))
        library.toggleFavorite(station("d"))
        library.toggleFavorite(station("e"))

        library.reorderFavorites(["a", "missing", "c"])

        XCTAssertEqual(library.favorites.map(\.id), ["a", "c", "e", "d", "b"])
    }

    func testCreateStationListPersistsAcrossInstances() {
        let first = Library(defaults: defaults)
        let list = first.createStationList(name: " Morning ", stations: [station("a"), station("b")])

        let second = Library(defaults: defaults)

        XCTAssertEqual(second.stationLists.map(\.id), [list.id])
        XCTAssertEqual(second.stationLists.first?.name, "Morning")
        XCTAssertEqual(second.stationLists.first?.stations.map(\.id), ["a", "b"])
    }

    func testCreateStationListDedupesStationsAndUsesFallbackName() {
        let library = Library(defaults: defaults)

        let list = library.createStationList(name: "   ", stations: [station("a"), station("b"), station("a")])

        XCTAssertEqual(list.name, "Station List")
        XCTAssertEqual(list.stations.map(\.id), ["a", "b"])
        XCTAssertEqual(library.stationLists.first?.stations.map(\.id), ["a", "b"])
    }

    func testRenameStationList() {
        let library = Library(defaults: defaults)
        let list = library.createStationList(name: "Old")

        XCTAssertTrue(library.renameStationList(id: list.id, name: " New "))
        XCTAssertFalse(library.renameStationList(id: "missing", name: "Other"))

        XCTAssertEqual(library.stationLists.first?.name, "New")
    }

    func testRemoveStationList() {
        let library = Library(defaults: defaults)
        let first = library.createStationList(name: "First")
        let second = library.createStationList(name: "Second")

        XCTAssertTrue(library.removeStationList(id: first.id))
        XCTAssertFalse(library.removeStationList(id: "missing"))

        XCTAssertEqual(library.stationLists.map(\.id), [second.id])
    }

    func testReorderStationListsDropsUnknownIdsAndKeepsMissedLists() {
        let library = Library(defaults: defaults)
        let first = library.createStationList(name: "First")
        let second = library.createStationList(name: "Second")
        let third = library.createStationList(name: "Third")

        XCTAssertTrue(library.reorderStationLists([first.id, "missing", third.id]))

        XCTAssertEqual(library.stationLists.map(\.id), [first.id, third.id, second.id])
    }

    func testAddStationToStationListPreventsDuplicates() {
        let library = Library(defaults: defaults)
        let list = library.createStationList(name: "Morning")
        let fm4 = station("fm4", name: "FM4")

        XCTAssertTrue(library.addStation(fm4, toStationList: list.id))
        XCTAssertFalse(library.addStation(fm4, toStationList: list.id))

        XCTAssertEqual(library.stationList(id: list.id)?.stations.map(\.id), ["fm4"])
    }

    func testAddStationToStationListUpdatesExistingSnapshot() {
        let library = Library(defaults: defaults)
        let list = library.createStationList(name: "Morning", stations: [station("fm4", name: "Old")])

        XCTAssertTrue(library.addStation(station("fm4", name: "New"), toStationList: list.id))

        XCTAssertEqual(library.stationList(id: list.id)?.stations.map(\.id), ["fm4"])
        XCTAssertEqual(library.stationList(id: list.id)?.stations.first?.name, "New")
    }

    func testRemoveStationFromStationList() {
        let library = Library(defaults: defaults)
        let list = library.createStationList(name: "Morning", stations: [station("a"), station("b")])

        XCTAssertTrue(library.removeStation(stationID: "a", fromStationList: list.id))
        XCTAssertFalse(library.removeStation(stationID: "missing", fromStationList: list.id))

        XCTAssertEqual(library.stationList(id: list.id)?.stations.map(\.id), ["b"])
    }

    func testReorderStationListStationsDropsUnknownIdsAndKeepsMissedStations() {
        let library = Library(defaults: defaults)
        let list = library.createStationList(name: "Morning", stations: [station("a"), station("b"), station("c")])

        XCTAssertTrue(library.reorderStations(inStationList: list.id, orderedIds: ["c", "missing", "a"]))

        XCTAssertEqual(library.stationList(id: list.id)?.stations.map(\.id), ["c", "a", "b"])
    }

    func testStationListChangesAreReported() {
        let library = Library(defaults: defaults)
        var changes: [Library.Change] = []
        library.onChange = { changes.append($0) }

        let list = library.createStationList(name: "Morning")
        library.addStation(station("a"), toStationList: list.id)

        XCTAssertEqual(changes, [.stationLists, .stationLists])
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

    func testCloudSyncApplyRestoresCustomStationsAsFavorites() {
        let library = Library(defaults: defaults)
        let custom = station("custom-a", name: "Custom A")

        library.applyCloudSync(
            favorites: [],
            customStations: [custom],
            stationLists: [],
        )

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

    func testRemoveCustomAlsoRemovesSavedStationListCopies() {
        let library = Library(defaults: defaults)
        let custom = station("custom-a")
        library.addCustom(custom)
        let list = library.createStationList(name: "Custom", stations: [custom, station("catalog-a")])

        library.removeCustom(id: "custom-a")

        XCTAssertEqual(library.stationList(id: list.id)?.stations.map(\.id), ["catalog-a"])
    }

    func testUnfavoritingCustomStationRemovesCustomRecord() {
        let library = Library(defaults: defaults)
        let custom = station("custom-a")
        library.addCustom(custom)
        library.pushRecent(custom)
        library.createStationList(name: "Custom", stations: [custom])

        XCTAssertFalse(library.toggleFavorite(custom))

        XCTAssertTrue(library.customStations.isEmpty)
        XCTAssertTrue(library.favorites.isEmpty)
        XCTAssertTrue(library.recents.isEmpty)
        XCTAssertTrue(library.stationLists.allSatisfy { list in
            !list.stations.contains { $0.id == custom.id }
        })
    }
}
