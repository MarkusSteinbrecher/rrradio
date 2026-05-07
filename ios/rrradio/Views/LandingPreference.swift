import Foundation

enum LandingPage: String, CaseIterable, Identifiable {
    case browse
    case favorites
    case station

    static let storageKey = "rrradio.landing.page.v1"
    static let stationIDKey = "rrradio.landing.stationID.v1"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .browse: "globe"
        case .favorites: "heart"
        case .station: "play.circle"
        }
    }
}
