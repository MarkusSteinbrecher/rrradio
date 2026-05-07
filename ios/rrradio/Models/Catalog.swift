import Foundation
import Observation

/// Loads + caches the rrradio catalog. Strategy:
///   1. On launch, return the bundled fallback (if any) instantly so the
///      UI has something to render.
///   2. Fetch the canonical JSON from rrradio.org over HTTPS.
///   3. Cache the latest payload to the user's Caches directory; reuse on
///      next launch if the network fetch fails.
///
/// The single source of truth lives in `data/stations.yaml` in this repo
/// and is published as `public/stations.json` by `tools/build-catalog.mjs`
/// on every web deploy. So the iOS app picks up new / promoted stations
/// without going through the App Store.
///
/// `@MainActor` (audit #72) — `@Observable` state must mutate on the
/// main thread for SwiftUI to track it safely. URLSession's `data(for:)`
/// suspends and runs the network call off-main, then resumes on main
/// when awaited from a MainActor context, so this stays correct.
/// Function-valued seam that production passes through `URLSession.shared.data(for:)`
/// and tests replace with a canned-response stub. Audit #72 follow-up.
/// Not `@Sendable` — under Swift 5.10's stricter rules the test stubs
/// would have to drop self captures, which makes fixture setup awkward.
/// The closure runs from a `@MainActor` async context anyway.
typealias CatalogDataFetcher = (URLRequest) async throws -> (Data, URLResponse)

@Observable
@MainActor
final class Catalog {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private(set) var stations: [Station] = []
    private(set) var state: LoadState = .idle

    nonisolated static let canonicalURL = URL(string: "https://rrradio.org/stations.json")!

    private let fetch: CatalogDataFetcher
    private let cacheURL: URL
    private let url: URL

    /// Production callers use the no-arg init; tests inject a custom
    /// `fetch` closure + a temp `cacheURL` so the URL-session fallback
    /// path can be exercised hermetically.
    init(
        url: URL = Catalog.canonicalURL,
        fetch: @escaping CatalogDataFetcher = { try await URLSession.shared.data(for: $0) },
        cacheURL: URL? = nil,
    ) {
        self.url = url
        self.fetch = fetch
        self.cacheURL = cacheURL ?? FileManager.default
            .urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("stations.json")
    }

    /// Idempotent — loads the catalog once per app session. Subsequent
    /// callers just see whatever's already loaded.
    func loadIfNeeded() async {
        if !stations.isEmpty || state == .loading { return }
        state = .loading

        // Disk cache first — instant render even when offline.
        if let cached = readCache() {
            stations = cached
            state = .loaded
        }

        // Then refresh from network.
        do {
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await fetch(req)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                throw URLError(.badServerResponse)
            }
            let parsed = try JSONDecoder().decode(CatalogResponse.self, from: data)
            stations = parsed.stations
            state = .loaded
            try? data.write(to: cacheURL, options: .atomic)
        } catch {
            // Keep the cached data we already showed; surface the error
            // only when there's nothing on screen at all.
            if stations.isEmpty {
                state = .failed(error.localizedDescription)
            } else {
                state = .loaded
            }
        }
    }

    private func readCache() -> [Station]? {
        guard let data = try? Data(contentsOf: cacheURL) else { return nil }
        return try? JSONDecoder().decode(CatalogResponse.self, from: data).stations
    }

    /// Stations in the order the YAML lists them, with `featured: true`
    /// floated to the top — same convention as the web home view.
    var browseOrdered: [Station] {
        let featured = stations.filter { $0.featured == true }
        let rest = stations.filter { $0.featured != true }
        return featured + rest
    }
}
