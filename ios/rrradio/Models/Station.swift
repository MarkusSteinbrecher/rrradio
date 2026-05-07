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
    /// Per-station "now-playing" endpoint or fetcher-specific slug when
    /// the broadcaster has one.
    var metadataUrl: String? = nil
    /// Key into the Swift-side metadata-fetcher registry. Mirrors the
    /// TypeScript `metadata` field.
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

extension Station {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try Self.decodeLossyString(.name, from: container)

        let streamUrlValue = try container.decode(String.self, forKey: .streamUrl)
        guard let streamUrl = URL(string: streamUrlValue), !streamUrlValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .streamUrl,
                in: container,
                debugDescription: "Invalid streamUrl",
            )
        }
        self.streamUrl = streamUrl

        homepage = Self.decodeOptionalURL(.homepage, from: container)
        country = try container.decodeIfPresent(String.self, forKey: .country)
        tags = try container.decodeIfPresent([String].self, forKey: .tags)
        favicon = Self.decodeOptionalURL(.favicon, from: container, relativeTo: Catalog.canonicalURL)
        bitrate = try container.decodeIfPresent(Int.self, forKey: .bitrate)
        codec = try container.decodeIfPresent(String.self, forKey: .codec)
        listeners = try container.decodeIfPresent(Int.self, forKey: .listeners)
        metadataUrl = try container.decodeIfPresent(String.self, forKey: .metadataUrl)
        metadata = try container.decodeIfPresent(String.self, forKey: .metadata)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        geo = try container.decodeIfPresent([Double].self, forKey: .geo)
        featured = try container.decodeIfPresent(Bool.self, forKey: .featured)
    }

    private static func decodeOptionalURL(
        _ key: CodingKeys,
        from container: KeyedDecodingContainer<CodingKeys>,
        relativeTo baseURL: URL? = nil,
    ) -> URL? {
        guard let value = try? container.decodeIfPresent(String.self, forKey: key)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        if let url = URL(string: value), url.scheme != nil {
            return url
        }
        guard let baseURL else { return URL(string: value) }
        return URL(string: value, relativeTo: baseURL)?.absoluteURL
    }

    private static func decodeLossyString(
        _ key: CodingKeys,
        from container: KeyedDecodingContainer<CodingKeys>,
    ) throws -> String {
        if let value = try? container.decode(String.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int.self, forKey: key) {
            return String(value)
        }
        if let value = try? container.decode(Double.self, forKey: key) {
            return String(value)
        }
        throw DecodingError.typeMismatch(
            String.self,
            DecodingError.Context(
                codingPath: container.codingPath + [key],
                debugDescription: "Expected string-compatible value",
            ),
        )
    }
}

/// Top-level wrapper of `stations.json`. The `$schema` line is ignored.
struct CatalogResponse: Decodable {
    let stations: [Station]
}
