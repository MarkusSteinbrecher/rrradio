import Foundation

enum LibraryListSelection: Equatable, Hashable, Identifiable {
    case home
    case recents
    case favorites
    case stationList(String)

    static let storageKey = "rrradio.library.selectedList.v1"
    static let homeRawValue = "home"
    static let recentsRawValue = "recents"
    static let favoritesRawValue = "favorites"
    static let stationListPrefix = "station-list:"

    var id: String { rawValue }

    init(rawValue: String?) {
        guard let rawValue, !rawValue.isEmpty else {
            self = .home
            return
        }
        if rawValue.hasPrefix(Self.stationListPrefix) {
            let id = String(rawValue.dropFirst(Self.stationListPrefix.count))
            self = id.isEmpty ? .home : .stationList(id)
            return
        }
        switch rawValue {
        case Self.recentsRawValue:
            self = .recents
        case Self.favoritesRawValue:
            self = .favorites
        default:
            self = .home
        }
    }

    var rawValue: String {
        switch self {
        case .home:
            return Self.homeRawValue
        case .recents:
            return Self.recentsRawValue
        case .favorites:
            return Self.favoritesRawValue
        case .stationList(let id):
            return Self.stationListPrefix + id
        }
    }

    var stationListID: String? {
        if case .stationList(let id) = self {
            return id
        }
        return nil
    }

    func normalized(for stationLists: [StationList]) -> LibraryListSelection {
        guard let stationListID else { return self }
        return stationLists.contains { $0.id == stationListID } ? self : .home
    }

    static func orderedSelections(for stationLists: [StationList]) -> [LibraryListSelection] {
        [.home, .recents, .favorites] + stationLists.map { .stationList($0.id) }
    }
}
