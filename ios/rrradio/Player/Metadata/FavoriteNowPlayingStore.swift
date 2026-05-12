import Foundation
import Observation

struct FavoriteNowPlayingEntry: Equatable {
    let metadata: NowPlayingMetadata
    let updatedAt: Date
}

@Observable
@MainActor
final class FavoriteNowPlayingStore {
    private(set) var entries: [String: FavoriteNowPlayingEntry] = [:]

    private var task: Task<Void, Never>?
    private var stationIDs: [String] = []

    func start(stations: [Station]) {
        let ids = stations.map(\.id)
        guard ids != stationIDs else { return }

        stop()
        stationIDs = ids
        entries = entries.filter { ids.contains($0.key) }
        guard !stations.isEmpty else { return }

        task = Task { [weak self] in
            while !Task.isCancelled {
                await Self.fetchMetadata(for: stations) { [weak self] stationID, entry in
                    guard let self else { return }
                    await self.applyEntry(stationID: stationID, entry: entry, expectedIDs: ids)
                }

                do {
                    try await Task.sleep(nanoseconds: 60_000_000_000)
                } catch {
                    return
                }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        stationIDs = []
    }

    private func applyEntry(stationID: String, entry: FavoriteNowPlayingEntry, expectedIDs: [String]) {
        guard stationIDs == expectedIDs else { return }
        entries[stationID] = entry
    }

    private nonisolated static func fetchMetadata(
        for stations: [Station],
        onEntry: @escaping @Sendable (String, FavoriteNowPlayingEntry) async -> Void,
    ) async {
        await withTaskGroup(of: (String, FavoriteNowPlayingEntry)?.self) { group in
            for station in stations {
                group.addTask {
                    guard let metadata = await fetchMetadata(for: station) else { return nil }
                    return (station.id, FavoriteNowPlayingEntry(metadata: metadata, updatedAt: Date()))
                }
            }

            for await result in group {
                guard let (stationID, entry) = result else { continue }
                await onEntry(stationID, entry)
            }
        }
    }

    nonisolated static func fetchMetadata(for station: Station) async -> NowPlayingMetadata? {
        do {
            guard var metadata = try await metadata(for: station) else { return nil }
            if let title = clean(metadata.title),
               metadata.coverUrl == nil || metadata.coverUrl.map(isLowResolutionCoverURL) == true {
                let cover = await lookupCoverArt(artist: clean(metadata.artist), title: title)
                if let cover {
                    metadata.coverUrl = cover
                }
            }
            return metadata
        } catch {
            return nil
        }
    }

    nonisolated static func metadata(
        for station: Station,
        fetcher: StationMetadataFetcher? = nil,
        icyFetch: @escaping StationMetadataFetcher = { try await fetchIcyMetadata(station: $0) },
        hlsFetch: @escaping StationMetadataFetcher = { try await fetchHlsTimedMetadata(station: $0) },
    ) async throws -> NowPlayingMetadata? {
        let resolvedFetcher = fetcher ?? (station.status == "icy-only" ? nil : metadataFetcher(for: station))
        if let fetcher = resolvedFetcher,
           let metadata = try await fetcher(station) {
            return metadata
        }
        if station.status == "icy-only" {
            return try await icyFetch(station)
        }
        guard station.streamUrl.pathExtension.lowercased() == "m3u8" else { return nil }
        return try await hlsFetch(station)
    }

    private nonisolated static func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
}
