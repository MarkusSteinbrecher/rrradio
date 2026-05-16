package org.rrradio.android.data

import java.text.Normalizer
import java.util.Locale

enum class BrowseStationSort {
    AlphabetAscending,
    AlphabetDescending,
    QualityLow,
    QualityHigh,
    FavoritesFirst,
    FavoritesLast,
}

private val curatedGenreTags = listOf(
    "jazz",
    "ambient",
    "classical",
    "electronic",
    "indie",
    "rock",
    "eclectic",
)

fun normalizeForSearch(value: String): String =
    value.lowercase().filter { ch ->
        ch.isLetterOrDigit() || ch == 'ä' || ch == 'ö' || ch == 'ü' || ch == 'ß'
    }

private fun normalizeForSearchFolded(value: String): String {
    val expanded = value.lowercase()
        .replace("ß", "ss")
        .replace("ø", "o")
        .replace("æ", "ae")
        .replace("œ", "oe")
    val decomposed = Normalizer.normalize(expanded, Normalizer.Form.NFD)
    return decomposed
        .filterNot { Character.getType(it) == Character.NON_SPACING_MARK.toInt() }
        .filter { it.isLetterOrDigit() }
}

fun stationMatches(station: Station, query: String): Boolean {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return true
    if (station.name.lowercase().contains(q)) return true
    if (station.tags.orEmpty().any { it.lowercase().contains(q) }) return true
    if (station.country?.lowercase()?.contains(q) == true) return true
    if (station.country?.let { countryDisplayName(it).lowercase().contains(q) } == true) return true

    val normalized = normalizeForSearch(q)
    val folded = normalizeForSearchFolded(q)
    return (normalized.isNotEmpty() && normalizeForSearch(station.name).contains(normalized)) ||
        (folded.isNotEmpty() && searchableValues(station).any { normalizeForSearchFolded(it).contains(folded) })
}

private fun searchableValues(station: Station): List<String> =
    listOfNotNull(station.name, station.country?.let(::countryDisplayName)) + station.tags.orEmpty()

fun stationMatchesFilters(station: Station, country: String?, tag: String?): Boolean {
    if (country != null && station.country?.uppercase() != country.uppercase()) return false
    if (tag != null && station.tags.orEmpty().none { it.lowercase() == tag.lowercase() }) return false
    return true
}

fun availableCountries(stations: List<Station>): List<String> =
    stations.mapNotNull { it.country?.trim()?.uppercase()?.takeIf { code -> code.length == 2 } }
        .toSet()
        .sortedBy { countryDisplayName(it) }

fun availableTags(stations: List<Station>): List<String> =
    stations.flatMap { it.tags.orEmpty() }
        .map { it.trim().lowercase() }
        .filter { it.isNotEmpty() }
        .toSet()
        .sorted()

fun availableCuratedGenres(stations: List<Station>): List<String> {
    val available = availableTags(stations).toSet()
    return curatedGenreTags.filter { it in available }
}

fun sortedBrowseStations(
    stations: List<Station>,
    sort: BrowseStationSort?,
    favoriteIds: Set<String>,
): List<Station> = when (sort) {
    BrowseStationSort.AlphabetAscending ->
        stations.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER, Station::displayName).thenBy(Station::id))
    BrowseStationSort.AlphabetDescending ->
        stations.sortedWith(compareByDescending<Station> { it.displayName().lowercase() }.thenByDescending { it.id })
    BrowseStationSort.QualityHigh ->
        stations.sortedWith(compareByDescending<Station> { streamQualityLevel(it.codec, it.bitrate) }.thenBy { it.displayName().lowercase() })
    BrowseStationSort.QualityLow ->
        stations.sortedWith(compareBy<Station> { streamQualityLevel(it.codec, it.bitrate) }.thenBy { it.displayName().lowercase() })
    BrowseStationSort.FavoritesFirst ->
        stations.sortedWith(compareByDescending<Station> { it.id in favoriteIds }.thenBy { it.displayName().lowercase() })
    BrowseStationSort.FavoritesLast ->
        stations.sortedWith(compareBy<Station> { it.id in favoriteIds }.thenBy { it.displayName().lowercase() })
    null -> stations
}

fun streamQualityLevel(codec: String?, bitrate: Int?): Int {
    val normalizedCodec = codec?.trim()?.lowercase().orEmpty()
    if (normalizedCodec in setOf("flac", "alac", "wav", "pcm")) return 4

    val normalizedBitrate = bitrate?.takeIf { it > 0 } ?: return 1
    return when {
        normalizedCodec.contains("aac") || normalizedCodec.contains("opus") -> when {
            normalizedBitrate >= 128 -> 4
            normalizedBitrate >= 96 -> 3
            normalizedBitrate >= 64 -> 2
            else -> 1
        }
        normalizedCodec.contains("mp3") || normalizedCodec.contains("mpeg") -> when {
            normalizedBitrate >= 192 -> 4
            normalizedBitrate >= 128 -> 3
            normalizedBitrate >= 96 -> 2
            else -> 1
        }
        normalizedBitrate >= 192 -> 4
        normalizedBitrate >= 128 -> 3
        normalizedBitrate >= 96 -> 2
        else -> 1
    }
}

fun countryDisplayName(code: String): String =
    Locale("", code.uppercase()).displayCountry.takeIf { it.isNotBlank() } ?: code.uppercase()
