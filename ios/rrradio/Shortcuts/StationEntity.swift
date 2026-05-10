import AppIntents
import Foundation

struct StationEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Station"
    static var defaultQuery = StationEntityQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct StationEntityQuery: EntityStringQuery {
    func entities(for identifiers: [StationEntity.ID]) async throws -> [StationEntity] {
        let wanted = Set(identifiers)
        return Self.localStations()
            .filter { wanted.contains($0.id) }
            .map(StationEntity.init(station:))
    }

    func entities(matching string: String) async throws -> [StationEntity] {
        let query = string.trimmingCharacters(in: .whitespacesAndNewlines)
        let stations = Self.localStations()
        guard !query.isEmpty else {
            return Array(stations.prefix(25)).map(StationEntity.init(station:))
        }
        return stations
            .filter { $0.name.localizedCaseInsensitiveContains(query) }
            .prefix(25)
            .map(StationEntity.init(station:))
    }

    func suggestedEntities() async throws -> [StationEntity] {
        Array(Self.localStations().prefix(25)).map(StationEntity.init(station:))
    }

    private static func localStations(defaults: UserDefaults = .standard) -> [Station] {
        uniqueStations(
            Library.readStations(Library.Keys.favorites, from: defaults)
                + Library.readStations(Library.Keys.recents, from: defaults)
                + Library.readStations(Library.Keys.custom, from: defaults)
                + cachedCatalogStations(),
        )
    }

    private static func cachedCatalogStations() -> [Station] {
        guard let data = try? Data(contentsOf: Catalog.defaultCacheURL),
              let response = try? JSONDecoder().decode(CatalogResponse.self, from: data) else {
            return []
        }
        return response.stations
    }

    private static func uniqueStations(_ stations: [Station]) -> [Station] {
        var seen: Set<String> = []
        return stations.filter { station in
            guard !seen.contains(station.id) else { return false }
            seen.insert(station.id)
            return true
        }
    }
}

private extension StationEntity {
    init(station: Station) {
        id = station.id
        name = station.name
    }
}
