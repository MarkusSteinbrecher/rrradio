import Foundation
import Observation

struct StationList: Identifiable, Hashable, Codable {
    let id: String
    var name: String
    var stations: [Station]
}

/// Device-local library state. Mirrors the web app's localStorage-backed
/// favorites + recents model, but stores the encoded station records in
/// UserDefaults so the app can render saved rows before the catalog has
/// refreshed from the network.
@Observable
@MainActor
final class Library {
    enum Change {
        case favorites
        case customStations
        case recents
        case stationLists
    }

    nonisolated enum Keys {
        static let favorites = "rrradio.favorites.v2"
        static let recents = "rrradio.recents.v2"
        static let custom = "rrradio.custom.v1"
        static let stationLists = "rrradio.station-lists.v1"
    }

    static let recentsLimit = 12
    private static let fallbackStationListName = "Station List"

    private let defaults: UserDefaults
    private(set) var favorites: [Station]
    private(set) var recents: [Station]
    private(set) var customStations: [Station]
    private(set) var stationLists: [StationList]
    @ObservationIgnored var onChange: ((Change) -> Void)?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        favorites = Self.readStations(Keys.favorites, from: defaults)
        recents = Self.readStations(Keys.recents, from: defaults)
        customStations = Self.readStations(Keys.custom, from: defaults)
        stationLists = Self.readStationLists(from: defaults)
        ensureCustomStationsAreFavorites()
    }

    func isFavorite(_ station: Station) -> Bool {
        favorites.contains { $0.id == station.id }
    }

    func addFavorite(_ station: Station) {
        if let idx = favorites.firstIndex(where: { $0.id == station.id }) {
            favorites[idx] = station
        } else {
            favorites.insert(station, at: 0)
        }
        writeFavorites()
    }

    /// Toggle favorite and return the new state, matching the web helper.
    @discardableResult
    func toggleFavorite(_ station: Station) -> Bool {
        if let idx = favorites.firstIndex(where: { $0.id == station.id }) {
            favorites.remove(at: idx)
            if isCustom(station) {
                customStations.removeAll { $0.id == station.id }
                recents.removeAll { $0.id == station.id }
                let removedFromLists = removeStationFromAllLists(stationID: station.id)
                writeCustom()
                writeRecents()
                if removedFromLists {
                    writeStationLists()
                }
            }
            writeFavorites()
            return false
        }
        favorites.insert(station, at: 0)
        writeFavorites()
        return true
    }

    func pushRecent(_ station: Station) {
        recents.removeAll { $0.id == station.id }
        recents.insert(station, at: 0)
        if recents.count > Self.recentsLimit {
            recents = Array(recents.prefix(Self.recentsLimit))
        }
        writeRecents()
    }

    func reorderFavorites(_ orderedIds: [String]) {
        var byId = Dictionary(uniqueKeysWithValues: favorites.map { ($0.id, $0) })
        var next: [Station] = []
        for id in orderedIds {
            if let station = byId.removeValue(forKey: id) {
                next.append(station)
            }
        }
        next.append(contentsOf: byId.values)
        favorites = next
        writeFavorites()
    }

    @discardableResult
    func createStationList(name: String, stations: [Station] = []) -> StationList {
        let list = StationList(
            id: UUID().uuidString,
            name: cleanedStationListName(name),
            stations: Self.uniqueStations(stations),
        )
        stationLists.insert(list, at: 0)
        writeStationLists()
        return list
    }

    @discardableResult
    func renameStationList(id: String, name: String) -> Bool {
        guard let idx = stationLists.firstIndex(where: { $0.id == id }) else { return false }
        let nextName = cleanedStationListName(name)
        guard stationLists[idx].name != nextName else { return false }
        stationLists[idx].name = nextName
        writeStationLists()
        return true
    }

    @discardableResult
    func removeStationList(id: String) -> Bool {
        let originalCount = stationLists.count
        stationLists.removeAll { $0.id == id }
        guard stationLists.count != originalCount else { return false }
        writeStationLists()
        return true
    }

    @discardableResult
    func reorderStationLists(_ orderedIds: [String]) -> Bool {
        let byId = Dictionary(uniqueKeysWithValues: stationLists.map { ($0.id, $0) })
        var next: [StationList] = []
        var seen = Set<String>()
        for id in orderedIds {
            if let list = byId[id], seen.insert(id).inserted {
                next.append(list)
            }
        }
        next.append(contentsOf: stationLists.filter { !seen.contains($0.id) })
        guard next != stationLists else { return false }
        stationLists = next
        writeStationLists()
        return true
    }

    @discardableResult
    func addStation(_ station: Station, toStationList listID: String) -> Bool {
        guard let listIndex = stationLists.firstIndex(where: { $0.id == listID }) else { return false }
        if let stationIndex = stationLists[listIndex].stations.firstIndex(where: { $0.id == station.id }) {
            guard stationLists[listIndex].stations[stationIndex] != station else { return false }
            stationLists[listIndex].stations[stationIndex] = station
        } else {
            stationLists[listIndex].stations.insert(station, at: 0)
        }
        writeStationLists()
        return true
    }

    @discardableResult
    func removeStation(_ station: Station, fromStationList listID: String) -> Bool {
        removeStation(stationID: station.id, fromStationList: listID)
    }

    @discardableResult
    func removeStation(stationID: String, fromStationList listID: String) -> Bool {
        guard let listIndex = stationLists.firstIndex(where: { $0.id == listID }) else { return false }
        let originalCount = stationLists[listIndex].stations.count
        stationLists[listIndex].stations.removeAll { $0.id == stationID }
        guard stationLists[listIndex].stations.count != originalCount else { return false }
        writeStationLists()
        return true
    }

    @discardableResult
    func reorderStations(inStationList listID: String, orderedIds: [String]) -> Bool {
        guard let listIndex = stationLists.firstIndex(where: { $0.id == listID }) else { return false }
        let reordered = Self.reorderedStations(stationLists[listIndex].stations, orderedIds: orderedIds)
        guard reordered != stationLists[listIndex].stations else { return false }
        stationLists[listIndex].stations = reordered
        writeStationLists()
        return true
    }

    func stationList(id: String) -> StationList? {
        stationLists.first { $0.id == id }
    }

    func refreshFavorites(from catalogStations: [Station]) {
        guard !favorites.isEmpty, !catalogStations.isEmpty else { return }
        let catalogByID = Dictionary(uniqueKeysWithValues: catalogStations.map { ($0.id, $0) })
        var changed = false
        let refreshed = favorites.map { station in
            guard let catalogStation = catalogByID[station.id] else { return station }
            changed = changed || catalogStation != station
            return catalogStation
        }
        guard changed else { return }
        favorites = refreshed
        writeFavorites()
    }

    func isCustom(_ station: Station) -> Bool {
        customStations.contains { $0.id == station.id }
    }

    func addCustom(_ station: Station, favorite: Bool = true) {
        if let idx = customStations.firstIndex(where: { $0.id == station.id }) {
            customStations[idx] = station
        } else {
            customStations.insert(station, at: 0)
        }
        if favorite {
            addFavorite(station)
        } else {
            favorites.removeAll { $0.id == station.id }
            writeFavorites()
        }
        writeCustom()
    }

    private func ensureCustomStationsAreFavorites() {
        let favoriteIds = Set(favorites.map(\.id))
        let missingCustomFavorites = customStations.filter { !favoriteIds.contains($0.id) }
        guard !missingCustomFavorites.isEmpty else { return }
        favorites = missingCustomFavorites + favorites
        writeFavorites()
    }

    func removeCustom(_ station: Station) {
        removeCustom(id: station.id)
    }

    func removeCustom(id: String) {
        customStations.removeAll { $0.id == id }
        favorites.removeAll { $0.id == id }
        recents.removeAll { $0.id == id }
        let removedFromLists = removeStationFromAllLists(stationID: id)
        writeCustom()
        writeFavorites()
        writeRecents()
        if removedFromLists {
            writeStationLists()
        }
    }

    private func writeFavorites() {
        Self.writeStations(favorites, key: Keys.favorites, to: defaults)
        onChange?(.favorites)
    }

    private func writeRecents() {
        Self.writeStations(recents, key: Keys.recents, to: defaults)
        onChange?(.recents)
    }

    private func writeCustom() {
        Self.writeStations(customStations, key: Keys.custom, to: defaults)
        onChange?(.customStations)
    }

    private func writeStationLists() {
        Self.writeStationLists(stationLists, to: defaults)
        onChange?(.stationLists)
    }

    func applyCloudSync(
        favorites nextFavorites: [Station],
        customStations nextCustomStations: [Station],
        stationLists nextStationLists: [StationList],
    ) {
        favorites = nextFavorites
        customStations = nextCustomStations
        stationLists = nextStationLists
        Self.writeStations(favorites, key: Keys.favorites, to: defaults)
        Self.writeStations(customStations, key: Keys.custom, to: defaults)
        Self.writeStationLists(stationLists, to: defaults)
    }

    private func cleanedStationListName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? Self.fallbackStationListName : trimmed
    }

    @discardableResult
    private func removeStationFromAllLists(stationID: String) -> Bool {
        var changed = false
        stationLists = stationLists.map { list in
            let filteredStations = list.stations.filter { $0.id != stationID }
            changed = changed || filteredStations.count != list.stations.count
            return StationList(id: list.id, name: list.name, stations: filteredStations)
        }
        return changed
    }

    nonisolated static func readStations(_ key: String, from defaults: UserDefaults) -> [Station] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Station].self, from: data)) ?? []
    }

    nonisolated static func readStationLists(from defaults: UserDefaults) -> [StationList] {
        guard let data = defaults.data(forKey: Keys.stationLists) else { return [] }
        return (try? JSONDecoder().decode([StationList].self, from: data)) ?? []
    }

    private static func writeStations(_ stations: [Station], key: String, to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(stations) else { return }
        defaults.set(data, forKey: key)
    }

    private static func writeStationLists(_ stationLists: [StationList], to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(stationLists) else { return }
        defaults.set(data, forKey: Keys.stationLists)
    }

    private static func uniqueStations(_ stations: [Station]) -> [Station] {
        var seen = Set<String>()
        return stations.filter { station in
            seen.insert(station.id).inserted
        }
    }

    private static func reorderedStations(_ stations: [Station], orderedIds: [String]) -> [Station] {
        let byId = Dictionary(uniqueKeysWithValues: stations.map { ($0.id, $0) })
        var next: [Station] = []
        var seen = Set<String>()
        for id in orderedIds {
            if let station = byId[id], seen.insert(id).inserted {
                next.append(station)
            }
        }
        next.append(contentsOf: stations.filter { !seen.contains($0.id) })
        return next
    }
}
