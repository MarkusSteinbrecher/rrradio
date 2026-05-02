import Foundation

/// One station as published in `https://rrradio.org/stations.json`.
/// Schema mirrors the TypeScript `Station` interface in src/types.ts.
/// Optional fields use sensible Swift defaults.
struct Station: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let streamUrl: URL
    var homepage: URL?
    var country: String?
    var tags: [String]?
    var favicon: URL?
    var bitrate: Int?
    var codec: String?
    var listeners: Int?
    /// Per-station "now-playing" endpoint when the broadcaster has one.
    /// We don't consume it yet — the v1 player relies on AVPlayer's
    /// built-in `timedMetadata` for HLS ICY data.
    var metadataUrl: String?
    /// Key into the (future) Swift-side metadata-fetcher registry.
    /// Mirrors the TypeScript `metadata` field; ignored for now.
    var metadata: String?
    /// `working` / `icy-only` / `stream-only` per the catalog taxonomy.
    var status: String?
    /// `[lat, lon]` for map view.
    var geo: [Double]?
    var featured: Bool?

    enum CodingKeys: String, CodingKey {
        case id, name, streamUrl, homepage, country, tags, favicon
        case bitrate, codec, listeners, metadataUrl, metadata, status
        case geo, featured
    }
}

/// Top-level wrapper of `stations.json`. The `$schema` line is ignored.
struct CatalogResponse: Decodable {
    let stations: [Station]
}
