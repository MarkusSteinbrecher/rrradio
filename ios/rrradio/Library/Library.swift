import Foundation
import Observation

/// Device-local library state. Mirrors the web app's localStorage-backed
/// favorites + recents model, but stores the encoded station records in
/// UserDefaults so the app can render saved rows before the catalog has
/// refreshed from the network.
@Observable
@MainActor
final class Library {
    private enum Keys {
        static let favorites = "rrradio.favorites.v2"
        static let recents = "rrradio.recents.v2"
        static let custom = "rrradio.custom.v1"
    }

    static let recentsLimit = 12

    private let defaults: UserDefaults
    private(set) var favorites: [Station]
    private(set) var recents: [Station]
    private(set) var customStations: [Station]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        favorites = Self.readStations(Keys.favorites, from: defaults)
        recents = Self.readStations(Keys.recents, from: defaults)
        customStations = Self.readStations(Keys.custom, from: defaults)
    }

    func isFavorite(_ station: Station) -> Bool {
        favorites.contains { $0.id == station.id }
    }

    /// Toggle favorite and return the new state, matching the web helper.
    @discardableResult
    func toggleFavorite(_ station: Station) -> Bool {
        if let idx = favorites.firstIndex(where: { $0.id == station.id }) {
            favorites.remove(at: idx)
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

    func isCustom(_ station: Station) -> Bool {
        customStations.contains { $0.id == station.id }
    }

    func addCustom(_ station: Station) {
        if let idx = customStations.firstIndex(where: { $0.id == station.id }) {
            customStations[idx] = station
        } else {
            customStations.insert(station, at: 0)
        }
        writeCustom()
    }

    func removeCustom(_ station: Station) {
        removeCustom(id: station.id)
    }

    func removeCustom(id: String) {
        customStations.removeAll { $0.id == id }
        writeCustom()
    }

    private func writeFavorites() {
        Self.writeStations(favorites, key: Keys.favorites, to: defaults)
    }

    private func writeRecents() {
        Self.writeStations(recents, key: Keys.recents, to: defaults)
    }

    private func writeCustom() {
        Self.writeStations(customStations, key: Keys.custom, to: defaults)
    }

    private static func readStations(_ key: String, from defaults: UserDefaults) -> [Station] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Station].self, from: data)) ?? []
    }

    private static func writeStations(_ stations: [Station], key: String, to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(stations) else { return }
        defaults.set(data, forKey: key)
    }
}
