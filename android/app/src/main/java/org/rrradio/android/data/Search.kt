package org.rrradio.android.data

import java.text.Normalizer
import java.util.Locale

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

fun countryDisplayName(code: String): String =
    Locale("", code.uppercase()).displayCountry.takeIf { it.isNotBlank() } ?: code.uppercase()
