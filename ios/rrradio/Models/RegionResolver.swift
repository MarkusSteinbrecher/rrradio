import Foundation
import Observation

/// Visitor region detection for geo-restricted stations.
///
/// Hits the rrradio-stats Worker's `/api/public/region` endpoint, which
/// echoes Cloudflare's `CF-IPCountry` header — the visitor's network
/// location, not the device locale. Cached for 24h in UserDefaults so
/// repeated launches don't pay the round-trip.
///
/// `current` is nil when:
///   • the fetch hasn't completed yet (first launch, expired cache),
///   • the Worker returned `null` (Tor, anycast, unknown IP), or
///   • the network is unreachable.
///
/// Callers should treat nil as "unknown" and fall back to "no
/// restriction" UX — better to show a working station than to badge
/// one as unavailable because we can't read the IP geo header.
@Observable
@MainActor
final class RegionResolver {
    static let shared = RegionResolver()

    /// Latest known country code (uppercase ISO 3166-1 alpha-2) or
    /// nil when unknown. SwiftUI views observing this redraw when
    /// the value flips after the initial fetch resolves.
    private(set) var current: String?

    private let cacheKey = "rrradio.region.v1"
    private let cacheKeyFetchedAt = "rrradio.region.v1.fetchedAt"
    // 24h — countries don't change often, and a stale day on a trip
    // is preferable to refetching on every app launch.
    private let cacheTTL: TimeInterval = 24 * 60 * 60

    private var fetchTask: Task<Void, Never>?

    private init() {
        loadFromCache()
        refreshIfStale()
    }

    private func loadFromCache() {
        let defaults = UserDefaults.standard
        guard
            let country = defaults.string(forKey: cacheKey),
            let fetchedAt = defaults.object(forKey: cacheKeyFetchedAt) as? Date,
            Date().timeIntervalSince(fetchedAt) < cacheTTL
        else { return }
        current = country.isEmpty ? nil : country
    }

    /// Fire-and-forget refresh. Idempotent — concurrent calls share a
    /// single in-flight task so the Worker isn't hit per-view.
    func refreshIfStale() {
        if fetchTask != nil { return }
        let defaults = UserDefaults.standard
        if
            let fetchedAt = defaults.object(forKey: cacheKeyFetchedAt) as? Date,
            Date().timeIntervalSince(fetchedAt) < cacheTTL
        {
            return
        }
        fetchTask = Task { [weak self] in
            defer { Task { @MainActor [weak self] in self?.fetchTask = nil } }
            await self?.performFetch()
        }
    }

    private func performFetch() async {
        let urlString = "\(WorkerAPI.base)/api/public/region"
        guard let url = URL(string: urlString) else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard
                let http = response as? HTTPURLResponse,
                http.statusCode == 200
            else { return }
            struct Body: Decodable { let country: String? }
            let body = try JSONDecoder().decode(Body.self, from: data)
            let country = body.country?.uppercased()
            await MainActor.run {
                self.current = country
                let defaults = UserDefaults.standard
                defaults.set(country ?? "", forKey: self.cacheKey)
                defaults.set(Date(), forKey: self.cacheKeyFetchedAt)
            }
        } catch {
            // Fail open — leave `current` unchanged, don't update the
            // cache. Next launch retries instead of pinning unknown
            // for a day after a transient network blip.
        }
    }

    /// True when the station has no known geo-restriction, the
    /// visitor is in the allow-list, or the visitor's country is
    /// unknown. Fails open — when in doubt we show the station as
    /// available rather than badge a working one as unavailable.
    func isAvailable(_ station: Station) -> Bool {
        guard let allowed = station.availableIn, !allowed.isEmpty else { return true }
        guard let me = current else { return true }
        return allowed.contains(me.uppercased())
    }

    /// Short user-facing label for the geo restriction. Returns nil
    /// when no badge should be shown — same gating as `isAvailable`
    /// but inverted, plus a nil when the visitor's region is unknown
    /// (we don't want to badge with copy that may be misleading).
    func restrictionLabel(
        _ station: Station,
        countryName: (String) -> String,
    ) -> String? {
        guard let allowed = station.availableIn, !allowed.isEmpty else { return nil }
        guard let me = current else { return nil }
        let upper = allowed.map { $0.uppercased() }
        if upper.contains(me.uppercased()) { return nil }
        if upper.count == 1 {
            return "\(countryName(upper[0])) only"
        }
        return "Only in " + upper.map(countryName).joined(separator: ", ")
    }
}

/// Single source of truth for the rrradio-stats Worker base URL.
/// Kept here next to `RegionResolver` because that's where it's
/// introduced; promote to a shared config file if a second caller
/// needs it.
enum WorkerAPI {
    static let base = "https://rrradio-stats.markussteinbrecher.workers.dev"
}
