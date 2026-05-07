import Foundation

let genreFilterTags = [
    "jazz",
    "ambient",
    "classical",
    "electronic",
    "indie",
    "rock",
    "eclectic",
]

func availableCountries(from stations: [Station]) -> [String] {
    Array(Set(stations.compactMap { station in
        let code = station.country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return code?.count == 2 ? code : nil
    }))
    .sorted { countryDisplayName($0) < countryDisplayName($1) }
}

func availableTags(from stations: [Station]) -> [String] {
    Array(Set(stations.flatMap { station in
        (station.tags ?? []).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        }
        .filter { !$0.isEmpty }
    }))
    .sorted()
}

func availableGenres(from stations: [Station]) -> [String] {
    let available = Set(availableTags(from: stations))
    return genreFilterTags.filter { available.contains($0) }
}

func stationMatchesFilters(_ station: Station, country: String?, tag: String?) -> Bool {
    if let country {
        guard station.country?.uppercased() == country.uppercased() else { return false }
    }
    if let tag {
        let normalizedTag = tag.lowercased()
        guard (station.tags ?? []).contains(where: { $0.lowercased() == normalizedTag }) else {
            return false
        }
    }
    return true
}

func countryDisplayName(_ code: String) -> String {
    Locale.current.localizedString(forRegionCode: code.uppercased()) ?? code.uppercased()
}

func countryFlagEmoji(_ code: String?) -> String {
    guard let code else { return "" }
    let scalars = code
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .uppercased()
        .unicodeScalars
    guard scalars.count == 2, scalars.allSatisfy({ ("A"..."Z").contains(String($0)) }) else {
        return ""
    }
    let regionalIndicatorOffset: UInt32 = 0x1F1E6 - 65
    let flagScalars = scalars.compactMap { UnicodeScalar($0.value + regionalIndicatorOffset) }
    return String(String.UnicodeScalarView(flagScalars))
}
