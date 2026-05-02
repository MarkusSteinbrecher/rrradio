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

/// Match a station's searchable surface (name + tags + country code)
/// against a query. Empty query returns true (filter is a no-op).
/// Both raw substring and whitespace-insensitive normalized match are
/// tried so "wdr5" finds "WDR 5".
func stationMatches(_ station: Station, query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    if q.isEmpty { return true }
    if station.name.lowercased().contains(q) { return true }
    if (station.tags ?? []).contains(where: { $0.lowercased().contains(q) }) { return true }
    if let cc = station.country?.lowercased(), cc.contains(q) { return true }
    let qNorm = normalizeForSearch(q)
    if !qNorm.isEmpty && normalizeForSearch(station.name).contains(qNorm) { return true }
    return false
}
