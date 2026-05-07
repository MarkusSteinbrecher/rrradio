import Foundation

private struct OrfBroadcast: Decodable {
    let start: Int
    let end: Int
    let href: URL
    let title: String?
    let subtitle: String?
}

private struct OrfDetail: Decodable {
    let items: [OrfItem]?
}

private struct OrfItem: Decodable {
    let type: String?
    let start: Int?
    let duration: Int?
    let title: String?
    let interpreter: String?
    let images: [OrfImage]?
}

private struct OrfImage: Decodable {
    let versions: [OrfImageVersion]?
}

private struct OrfImageVersion: Decodable {
    let path: URL?
    let width: Int?
}

func fetchOrfMetadata(
    station: Station,
    now: Date = Date(),
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let liveURL = URL(string: value) else { return nil }

    let live = try await fetchMetadataJSON([OrfBroadcast].self, url: liveURL, fetch: fetch)
    let nowMs = Int(now.timeIntervalSince1970 * 1000)
    guard let current = live.first(where: { $0.start <= nowMs && nowMs < $0.end }) else {
        return nil
    }

    let detail = try await fetchMetadataJSON(OrfDetail.self, url: current.href, fetch: fetch)
    let item = detail.items?.first(where: { item in
        guard let start = item.start, let duration = item.duration else { return false }
        return start <= nowMs && nowMs < start + duration
    })

    let programName = current.title?.trimmingCharacters(in: .whitespacesAndNewlines)
    let programSubtitle = metadataStripHTML(current.subtitle)
    guard let item, item.type == "M", let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        guard programName?.isEmpty == false else { return nil }
        return NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "",
            programName: programName,
            programSubtitle: programSubtitle,
        )
    }

    let artist = item.interpreter?.trimmingCharacters(in: .whitespacesAndNewlines)
    return NowPlayingMetadata(
        artist: artist?.isEmpty == true ? nil : artist,
        title: title,
        raw: [artist, title].compactMap { $0 }.joined(separator: " - "),
        programName: programName?.isEmpty == true ? nil : programName,
        programSubtitle: programSubtitle,
        coverUrl: bestOrfImage(item.images),
    )
}

private func bestOrfImage(_ images: [OrfImage]?) -> URL? {
    images?.first?.versions?.max { lhs, rhs in
        (lhs.width ?? 0) < (rhs.width ?? 0)
    }?.path
}
