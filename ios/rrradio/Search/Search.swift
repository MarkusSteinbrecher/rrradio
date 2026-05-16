import Foundation

/// Whitespace-insensitive search normalizer. Keeps a–z, 0–9, and the
/// German diacritics; folds other diacritics (é → e, ñ → n, ç → c…)
/// so users can type without accents. Drops everything else.
///
/// Mirrors the web's `normalizeForSearch` in src/format.ts so "WDR5"
/// matches "WDR 5" and "ndr 90,3" matches "ndr903" — extended here
/// with the accent-folding pass.
///
/// Pulled out of `StationListView.swift` for unit testability
/// (audit #72). Pure function — no Foundation locale surprises.
func normalizeForSearch(_ s: String) -> String {
    let lower = s.lowercased()
    var result = ""
    result.reserveCapacity(lower.count)
    for ch in lower {
        // Keep German umlauts and ß as-is — speakers expect "süd" not
        // "sud" after normalization, and the catalog stores them that
        // way too. (The diacritic-fold below would collapse them.)
        if ch == "ä" || ch == "ö" || ch == "ü" || ch == "ß" {
            result.append(ch)
            continue
        }
        guard ch.isLetter || ch.isNumber else { continue }
        // Per-character diacritic fold for everything else: "é" → "e",
        // "ñ" → "n", "ç" → "c". Lets users type "espana" → España,
        // "cafe" → Café. Numbers pass through unchanged.
        result.append(String(ch).folding(options: .diacriticInsensitive, locale: nil))
    }
    return result
}

/// Precomputed lowercased + normalized form of a station's searchable
/// surface, so `stationMatches` can do plain substring checks instead
/// of rebuilding the surface every keystroke. Cache one per station
/// (see `Catalog.searchHaystacks`).
struct SearchHaystack: Equatable {
    /// Lowercased fields joined with `\n` so a substring search can't
    /// accidentally span a field boundary (e.g. "br" + "de" → "brde").
    let raw: String
    /// `normalizeForSearch` applied to each field then concatenated.
    /// Separator already drops out of the normalizer so a plain
    /// concatenation is fine.
    let normalized: String
}

func buildSearchHaystack(for station: Station) -> SearchHaystack {
    let surface = stationSearchSurface(station)
    let raw = surface.map { $0.lowercased() }.joined(separator: "\n")
    let normalized = surface.map(normalizeForSearch).joined()
    return SearchHaystack(raw: raw, normalized: normalized)
}

/// Match a station's searchable surface (name + tags + country code +
/// broadcaster + stream/homepage hosts) against a query. Empty query
/// returns true (filter is a no-op).
///
/// Token-AND match: every whitespace-separated token of the query must
/// appear somewhere in the surface — raw lowercased OR normalized.
/// Order-independent, so "5 wdr" finds "WDR 5". Each token tries the
/// raw surface first, then falls back to the normalized form so
/// "wdr5" finds "WDR 5" and "80 station" finds "_80-Station".
///
/// Convenience overload that builds the haystack on the fly. Hot paths
/// should call `stationMatches(haystack:query:)` directly with a
/// precomputed haystack from `Catalog.searchHaystacks`.
func stationMatches(_ station: Station, query: String) -> Bool {
    stationMatches(haystack: buildSearchHaystack(for: station), query: query)
}

func stationMatches(haystack: SearchHaystack, query: String) -> Bool {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return true }
    for token in trimmed.split(whereSeparator: \.isWhitespace) {
        let lower = String(token).lowercased()
        if haystack.raw.contains(lower) { continue }
        let normalizedToken = normalizeForSearch(lower)
        guard !normalizedToken.isEmpty else { return false }
        if haystack.normalized.contains(normalizedToken) { continue }
        return false
    }
    return true
}

func stationSearchSurface(_ station: Station) -> [String] {
    var surface = [station.name]
    surface.append(contentsOf: station.tags ?? [])
    surface.append(station.country ?? "")
    surface.append(station.broadcaster ?? "")
    surface.append(station.streamUrl.host ?? "")
    surface.append(station.streamUrl.absoluteString)
    if let homepage = station.homepage {
        surface.append(homepage.host ?? "")
        surface.append(homepage.absoluteString)
    }
    return surface.filter { !$0.isEmpty }
}
