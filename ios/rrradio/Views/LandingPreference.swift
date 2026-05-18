import Foundation

enum LandingPage: String, CaseIterable, Identifiable {
    case browse
    case library
    case recents
    case favorites
    case stationList
    case station

    static let storageKey = "rrradio.landing.page.v1"
    static let stationIDKey = "rrradio.landing.stationID.v1"
    static let stationListIDKey = "rrradio.landing.stationListID.v1"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .browse: "globe"
        case .library: "square.grid.2x2"
        case .recents: "clock"
        case .favorites: "heart"
        case .stationList: "list.bullet.rectangle"
        case .station: "play.circle"
        }
    }
}
