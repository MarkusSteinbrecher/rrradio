import Foundation

/// One entry in a `Genre.match` list. `.text` is a case-insensitive
/// substring check (the default — "rock" also matches "classic rock",
/// "punk rock", "alpenrock"). `.regex` is used as-is against the
/// lowercased tag — reserve it for the rare term whose substring
/// would catch a non-music word.
///
/// The motivating case is "funk" vs the German "rundfunk"
/// ("broadcasting"): plain-substring "funk" matches every public
/// broadcaster tagged "mitteldeutscher rundfunk" /
/// "westdeutscher rundfunk" and dumps them into Soul/R&B. The
/// word-boundary regex `\bfunk[a-z]*\b` keeps "funk", "funky",
/// "future funk" while excluding "rundfunk". Mirrors the web fix
/// in src/genre-taxonomy.ts (PR #191).
///
/// `ExpressibleByStringLiteral` lets every other (non-tricky) genre
/// keep declaring its match list as `["pop", "pop music"]` without
/// per-entry wrapping.
enum MatchPattern: Equatable, ExpressibleByStringLiteral {
    case text(String)
    case regex(String)

    init(stringLiteral value: StringLiteralType) {
        self = .text(value)
    }
}

struct Genre: Equatable, Identifiable {
    let id: String
    let label: String
    let match: [MatchPattern]
    let rbTag: String
}

let genres: [Genre] = [
    Genre(id: "pop", label: "Pop", match: ["pop"], rbTag: "pop"),
    Genre(id: "rock", label: "Rock", match: ["rock"], rbTag: "rock"),
    Genre(id: "oldies", label: "Oldies", match: ["oldies", "classic hits", "60s", "70s", "80s", "90s", "schlager"], rbTag: "oldies"),
    Genre(id: "latin", label: "Latin", match: ["latino", "latin", "banda", "grupera", "salsa", "mariachi", "bachata", "merengue", "cumbia", "reggaeton", "spanish", "mexican", "brazilian", "sertanejo", "español", "tejano", "norteño", "romantica", "noticias"], rbTag: "latino"),
    Genre(id: "news", label: "News", match: ["news", "noticias"], rbTag: "news"),
    Genre(id: "talk", label: "Talk", match: ["talk"], rbTag: "talk"),
    Genre(id: "public", label: "Public", match: ["public radio", "community radio", "public", "community"], rbTag: "public radio"),
    Genre(id: "dance", label: "Dance", match: ["dance", "edm", "club"], rbTag: "dance"),
    Genre(id: "electronic", label: "Electronic", match: ["electronic", "electronica", "techno", "trance", "electro"], rbTag: "electronic"),
    Genre(id: "house", label: "House", match: ["house"], rbTag: "house"),
    Genre(id: "christian", label: "Christian", match: ["christian", "gospel", "religious", "worship"], rbTag: "christian"),
    Genre(id: "indie", label: "Indie/alt", match: ["indie", "alternative", "alt"], rbTag: "alternative"),
    Genre(id: "jazz", label: "Jazz", match: ["jazz"], rbTag: "jazz"),
    Genre(id: "classical", label: "Classical", match: ["classical", "orchestral"], rbTag: "classical"),
    Genre(id: "ambient", label: "Chill", match: ["ambient", "chillout", "chill", "lounge", "easy listening", "downtempo", "meditation", "relax"], rbTag: "ambient"),
    Genre(id: "country", label: "Country", match: ["country"], rbTag: "country"),
    Genre(id: "hiphop", label: "Hip hop", match: ["hip hop", "hip-hop", "hiphop", "rap", "r&b"], rbTag: "hip hop"),
    Genre(id: "sports", label: "Sports", match: ["sports", "sport"], rbTag: "sports"),
    Genre(id: "folk", label: "Folk", match: ["folk"], rbTag: "folk"),
    Genre(id: "reggae", label: "Reggae", match: ["reggae", "ska", "dancehall"], rbTag: "reggae"),
    Genre(id: "soul", label: "Soul/R&B", match: ["soul", "rnb", "rhythm and blues", .regex(#"\bfunk[a-z]*\b"#)], rbTag: "soul"),
    Genre(id: "metal", label: "Metal", match: ["metal"], rbTag: "metal"),
]

private let genresByID = Dictionary(uniqueKeysWithValues: genres.map { ($0.id, $0) })

func findGenre(_ id: String?) -> Genre? {
    guard let id, id != "all" else { return nil }
    return genresByID[id]
}

func availableCountries(from stations: [Station], preferredCountry: String? = deviceRegionCode()) -> [String] {
    let countries = Array(Set(stations.compactMap { station in
        let code = station.country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return code?.count == 2 ? code : nil
    }))
    .sorted { countryDisplayName($0) < countryDisplayName($1) }

    let preferred = preferredCountry?.uppercased()
    guard let preferred, countries.contains(preferred) else {
        return countries
    }

    return [preferred] + countries.filter { $0 != preferred }
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

func availableGenres(from stations: [Station]) -> [Genre] {
    genres.filter { genre in
        genre.id != "news" && stations.contains { stationMatchesGenre($0, genre: genre) }
    }
}

func stationMatchesGenre(_ station: Station, genre: Genre) -> Bool {
    guard let tags = station.tags, !tags.isEmpty else { return false }
    for tag in tags {
        let normalizedTag = tag.lowercased()
        for pattern in genre.match {
            switch pattern {
            case .text(let needle):
                if normalizedTag.contains(needle) { return true }
            case .regex(let raw):
                // Case-insensitive — both the tag and the regex are
                // lowercased already, so we don't need NSRegularExpression
                // case flags. Compiled per-call; the patterns are short
                // and the genre list is fixed, so this isn't hot.
                if normalizedTag.range(of: raw, options: .regularExpression) != nil {
                    return true
                }
            }
        }
    }
    return false
}

func stationMatchesFilters(_ station: Station, country: String?, tag: String?) -> Bool {
    if let country {
        guard station.country?.uppercased() == country.uppercased() else { return false }
    }
    if let tag {
        if let genre = findGenre(tag) {
            guard stationMatchesGenre(station, genre: genre) else { return false }
        } else {
            let normalizedTag = tag.lowercased()
            guard (station.tags ?? []).contains(where: { $0.lowercased() == normalizedTag }) else {
                return false
            }
        }
    }
    return true
}

func countryDisplayName(_ code: String) -> String {
    Locale.current.localizedString(forRegionCode: code.uppercased()) ?? code.uppercased()
}

func deviceRegionCode(locale: Locale = .current) -> String? {
    locale.region?.identifier.uppercased()
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
