import Foundation

enum WatchPlaybackCommandKind: String, Codable, Hashable {
    case playStation
    case pause
    case resume
    case toggle
    case stop
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
    let requestedAt: Date

    init(kind: WatchPlaybackCommandKind, stationID: String? = nil, requestedAt: Date = Date()) {
        self.kind = kind
        self.stationID = stationID
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

struct WatchPlaybackSnapshot: Codable, Hashable {
    let playbackState: WatchRemotePlaybackState
    let currentStation: WatchStationSummary?
    let nowPlayingTitle: String?
    let nowPlayingArtist: String?
    let nowPlayingProgramName: String?
    let nowPlayingCoverURL: URL?
    let favorites: [WatchStationSummary]
    let catalogStationCount: Int
    let generatedAt: Date

    static func empty(generatedAt: Date = Date()) -> WatchPlaybackSnapshot {
        WatchPlaybackSnapshot(
            playbackState: .idle,
            currentStation: nil,
            nowPlayingTitle: nil,
            nowPlayingArtist: nil,
            nowPlayingProgramName: nil,
            nowPlayingCoverURL: nil,
            favorites: [],
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
