import Foundation

let curatedGenreTags = [
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

func availableCuratedGenres(from stations: [Station]) -> [String] {
    let available = Set(availableTags(from: stations))
    return curatedGenreTags.filter { available.contains($0) }
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
