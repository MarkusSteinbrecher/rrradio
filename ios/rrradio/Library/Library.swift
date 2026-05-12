import Foundation
import Observation

enum FavoriteStationStepDirection: Equatable {
    case backward
    case forward
}

struct FavoriteStationQueueInfo: Equatable {
    let index: Int
    let count: Int
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
    }

    nonisolated enum Keys {
        static let favorites = "rrradio.favorites.v2"
        static let recents = "rrradio.recents.v2"
        static let custom = "rrradio.custom.v1"
    }

    static let recentsLimit = 12

    private let defaults: UserDefaults
    private(set) var favorites: [Station]
    private(set) var recents: [Station]
    private(set) var customStations: [Station]
    @ObservationIgnored var onChange: ((Change) -> Void)?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        favorites = Self.readStations(Keys.favorites, from: defaults)
        recents = Self.readStations(Keys.recents, from: defaults)
        customStations = Self.readStations(Keys.custom, from: defaults)
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
                writeCustom()
                writeRecents()
            }
            writeFavorites()
            return false
        }
        favorites.insert(station, at: 0)
        writeFavorites()
        return true
    }

    func saveAsFavoriteStationZeroIfNeeded(_ station: Station) {
        if let idx = favorites.firstIndex(where: { $0.id == station.id }) {
            guard favorites[idx] != station else { return }
            favorites[idx] = station
        } else {
            favorites.insert(station, at: 0)
        }
        writeFavorites()
    }

    func stationForFavoriteStep(from current: Station?, direction: FavoriteStationStepDirection) -> Station? {
        guard let current else {
            return favorites.first
        }

        guard let currentIndex = favorites.firstIndex(where: { $0.id == current.id }) else {
            saveAsFavoriteStationZeroIfNeeded(current)
            guard favorites.count > 1 else { return favorites.first }
            switch direction {
            case .backward:
                return favorites.last
            case .forward:
                return favorites[1]
            }
        }

        guard favorites.count > 1 else {
            return favorites[currentIndex]
        }

        switch direction {
        case .backward:
            return favorites[(currentIndex - 1 + favorites.count) % favorites.count]
        case .forward:
            return favorites[(currentIndex + 1) % favorites.count]
        }
    }

    func favoriteQueueInfo(for current: Station?) -> FavoriteStationQueueInfo? {
        guard !favorites.isEmpty || current != nil else { return nil }
        guard let current else {
            return FavoriteStationQueueInfo(index: 0, count: favorites.count)
        }

        if let currentIndex = favorites.firstIndex(where: { $0.id == current.id }) {
            return FavoriteStationQueueInfo(index: currentIndex, count: favorites.count)
        }

        return FavoriteStationQueueInfo(index: 0, count: favorites.count + 1)
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
        writeCustom()
        writeFavorites()
        writeRecents()
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

    func applyCloudSync(favorites nextFavorites: [Station], customStations nextCustomStations: [Station]) {
        favorites = nextFavorites
        customStations = nextCustomStations
        Self.writeStations(favorites, key: Keys.favorites, to: defaults)
        Self.writeStations(customStations, key: Keys.custom, to: defaults)
    }

    nonisolated static func readStations(_ key: String, from defaults: UserDefaults) -> [Station] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Station].self, from: data)) ?? []
    }

    private static func writeStations(_ stations: [Station], key: String, to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(stations) else { return }
        defaults.set(data, forKey: key)
    }
}
