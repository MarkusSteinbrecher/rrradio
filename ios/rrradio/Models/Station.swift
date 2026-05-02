import Foundation

/// One station as published in `https://rrradio.org/stations.json`.
/// Schema mirrors the TypeScript `Station` interface in src/types.ts.
/// Optional fields use sensible Swift defaults.
struct Station: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let streamUrl: URL
    // Explicit `= nil` defaults so the synthesized memberwise initializer
    // accepts test fixtures that only need a few fields, without having
    // to fill in the long tail of optionals (audit #72).
    var homepage: URL? = nil
    var country: String? = nil
    var tags: [String]? = nil
    var favicon: URL? = nil
    var bitrate: Int? = nil
    var codec: String? = nil
    var listeners: Int? = nil
    /// Per-station "now-playing" endpoint when the broadcaster has one.
    /// We don't consume it yet — the v1 player relies on AVPlayer's
    /// built-in `timedMetadata` for HLS ICY data.
    var metadataUrl: String? = nil
    /// Key into the (future) Swift-side metadata-fetcher registry.
    /// Mirrors the TypeScript `metadata` field; ignored for now.
    var metadata: String? = nil
    /// `working` / `icy-only` / `stream-only` per the catalog taxonomy.
    var status: String? = nil
    /// `[lat, lon]` for map view.
    var geo: [Double]? = nil
    var featured: Bool? = nil

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
