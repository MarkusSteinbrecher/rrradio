import Foundation

enum WatchPlaybackCommandKind: String, Codable, Hashable {
    case playStation
    case playActiveQueueStation
    case playStationList
    case pause
    case resume
    case toggle
    case stop
    case nextStation
    case previousStation
    case nextFavorite
    case previousFavorite
    case requestSnapshot
}

enum WatchRemotePlaybackState: String, Codable, Hashable {
    case idle
    case loading
    case playing
    case paused
    case error
}

struct WatchPlaybackCommandEnvelope: Codable, Hashable {
    let kind: WatchPlaybackCommandKind
    let stationID: String?
    let stationListID: String?
    let requestedAt: Date

    init(
        kind: WatchPlaybackCommandKind,
        stationID: String? = nil,
        stationListID: String? = nil,
        requestedAt: Date = Date()
    ) {
        self.kind = kind
        self.stationID = stationID
        self.stationListID = stationListID
        self.requestedAt = requestedAt
    }
}

struct WatchStationSummary: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let broadcaster: String?
    let country: String?
    let favicon: URL?
}

struct WatchStationListSummary: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let stationCount: Int
    let firstStation: WatchStationSummary?
}

enum WatchPlaybackQueueSource: String, Codable, Hashable {
    case browse
    case favorites
    case recents
    case stationList
    case single
}

struct WatchPlaybackQueueSummary: Codable, Hashable {
    let source: WatchPlaybackQueueSource
    let sourceID: String?
    let name: String?
    let stationCount: Int
    let currentIndex: Int?
}

struct WatchPlaybackSnapshot: Codable, Hashable {
    let playbackState: WatchRemotePlaybackState
    let currentStation: WatchStationSummary?
    let nowPlayingTitle: String?
    let nowPlayingArtist: String?
    let nowPlayingProgramName: String?
    let nowPlayingCoverURL: URL?
    let favorites: [WatchStationSummary]
    let stationLists: [WatchStationListSummary]
    let activeQueue: WatchPlaybackQueueSummary?
    let activeQueueStations: [WatchStationSummary]
    let catalogStationCount: Int
    let generatedAt: Date

    enum CodingKeys: String, CodingKey {
        case playbackState
        case currentStation
        case nowPlayingTitle
        case nowPlayingArtist
        case nowPlayingProgramName
        case nowPlayingCoverURL
        case favorites
        case stationLists
        case activeQueue
        case activeQueueStations
        case catalogStationCount
        case generatedAt
    }

    init(
        playbackState: WatchRemotePlaybackState,
        currentStation: WatchStationSummary?,
        nowPlayingTitle: String?,
        nowPlayingArtist: String?,
        nowPlayingProgramName: String?,
        nowPlayingCoverURL: URL?,
        favorites: [WatchStationSummary],
        stationLists: [WatchStationListSummary] = [],
        activeQueue: WatchPlaybackQueueSummary? = nil,
        activeQueueStations: [WatchStationSummary] = [],
        catalogStationCount: Int,
        generatedAt: Date
    ) {
        self.playbackState = playbackState
        self.currentStation = currentStation
        self.nowPlayingTitle = nowPlayingTitle
        self.nowPlayingArtist = nowPlayingArtist
        self.nowPlayingProgramName = nowPlayingProgramName
        self.nowPlayingCoverURL = nowPlayingCoverURL
        self.favorites = favorites
        self.stationLists = stationLists
        self.activeQueue = activeQueue
        self.activeQueueStations = activeQueueStations
        self.catalogStationCount = catalogStationCount
        self.generatedAt = generatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.playbackState = try container.decode(WatchRemotePlaybackState.self, forKey: .playbackState)
        self.currentStation = try container.decodeIfPresent(WatchStationSummary.self, forKey: .currentStation)
        self.nowPlayingTitle = try container.decodeIfPresent(String.self, forKey: .nowPlayingTitle)
        self.nowPlayingArtist = try container.decodeIfPresent(String.self, forKey: .nowPlayingArtist)
        self.nowPlayingProgramName = try container.decodeIfPresent(String.self, forKey: .nowPlayingProgramName)
        self.nowPlayingCoverURL = try container.decodeIfPresent(URL.self, forKey: .nowPlayingCoverURL)
        self.favorites = try container.decode([WatchStationSummary].self, forKey: .favorites)
        self.stationLists = try container.decodeIfPresent([WatchStationListSummary].self, forKey: .stationLists) ?? []
        self.activeQueue = try container.decodeIfPresent(WatchPlaybackQueueSummary.self, forKey: .activeQueue)
        self.activeQueueStations = try container.decodeIfPresent([WatchStationSummary].self, forKey: .activeQueueStations) ?? []
        self.catalogStationCount = try container.decode(Int.self, forKey: .catalogStationCount)
        self.generatedAt = try container.decode(Date.self, forKey: .generatedAt)
    }

    static func empty(generatedAt: Date = Date()) -> WatchPlaybackSnapshot {
        WatchPlaybackSnapshot(
            playbackState: .idle,
            currentStation: nil,
            nowPlayingTitle: nil,
            nowPlayingArtist: nil,
            nowPlayingProgramName: nil,
            nowPlayingCoverURL: nil,
            favorites: [],
            stationLists: [],
            activeQueue: nil,
            activeQueueStations: [],
            catalogStationCount: 0,
            generatedAt: generatedAt,
        )
    }
}

enum WatchRemoteMessageCodec {
    enum CodecError: Error {
        case invalidPayload
    }

    static let typeKey = "type"
    static let payloadKey = "payload"
    static let commandType = "org.rrradio.watch.command.v1"
    static let snapshotType = "org.rrradio.watch.snapshot.v1"

    static func message(for command: WatchPlaybackCommandEnvelope) throws -> [String: Any] {
        try message(type: commandType, payload: command)
    }

    static func command(from message: [String: Any]) throws -> WatchPlaybackCommandEnvelope? {
        guard message[typeKey] as? String == commandType else { return nil }
        return try decode(WatchPlaybackCommandEnvelope.self, from: message)
    }

    static func message(for snapshot: WatchPlaybackSnapshot) throws -> [String: Any] {
        try message(type: snapshotType, payload: snapshot)
    }

    static func snapshot(from message: [String: Any]) throws -> WatchPlaybackSnapshot? {
        guard message[typeKey] as? String == snapshotType else { return nil }
        return try decode(WatchPlaybackSnapshot.self, from: message)
    }

    private static func message<T: Encodable>(type: String, payload: T) throws -> [String: Any] {
        [
            typeKey: type,
            payloadKey: try JSONEncoder().encode(payload),
        ]
    }

    private static func decode<T: Decodable>(_ type: T.Type, from message: [String: Any]) throws -> T {
        guard let payload = message[payloadKey] as? Data else {
            throw CodecError.invalidPayload
        }
        return try JSONDecoder().decode(type, from: payload)
    }
}
