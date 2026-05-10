import Foundation

/// Whitespace-insensitive search normalizer. Keeps a–z, 0–9, and the
/// German diacritics; drops everything else. Mirrors the web's
/// `normalizeForSearch` in src/format.ts so "WDR5" matches "WDR 5"
/// and "ndr 90,3" matches "ndr 903".
///
/// Pulled out of `StationListView.swift` for unit testability
/// (audit #72). Pure function — no Foundation locale surprises.
func normalizeForSearch(_ s: String) -> String {
    s.lowercased().filter { ch in
        ch.isLetter || ch.isNumber || ch == "ä" || ch == "ö" || ch == "ü" || ch == "ß"
    }
}

/// Match a station's searchable surface (name + tags + country code +
/// broadcaster + stream/homepage hosts)
/// against a query. Empty query returns true (filter is a no-op).
/// Both raw substring and punctuation-insensitive normalized matches are
/// tried so "wdr5" finds "WDR 5" and "80 Station" finds "_80-Station".
func stationMatches(_ station: Station, query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    if q.isEmpty { return true }
    let surface = stationSearchSurface(station)
    if surface.contains(where: { $0.lowercased().contains(q) }) { return true }

    let qNorm = normalizeForSearch(q)
    guard !qNorm.isEmpty else { return false }

    let normalizedSurface = surface
        .map(normalizeForSearch)
        .joined(separator: " ")
    if normalizedSurface.contains(qNorm) { return true }

    return false
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
