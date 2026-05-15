package org.rrradio.android.data

import java.net.URI
import java.util.UUID

sealed class CustomStationValidationError(message: String) : IllegalArgumentException(message) {
    data object MissingName : CustomStationValidationError("Name is required.")
    data object MissingStreamUrl : CustomStationValidationError("Stream URL is required.")
    data object InvalidStreamUrl : CustomStationValidationError("Stream URL must be a valid URL.")
    data object InsecureStreamUrl : CustomStationValidationError("Stream URL must use https://.")
    data object PrivateStreamUrl : CustomStationValidationError("Stream URL must be a public internet address.")
    data object InvalidHomepage : CustomStationValidationError("Homepage must be a valid http:// or https:// URL.")
    data object InvalidCountry : CustomStationValidationError("Country must be a 2-letter code, for example CH.")
    data class DuplicateStreamUrl(val stationName: String) :
        CustomStationValidationError("This stream already exists as $stationName.")
}

fun makeCustomStation(
    name: String,
    streamUrl: String,
    homepage: String = "",
    country: String = "",
    tags: String = "",
    id: String = "custom-${UUID.randomUUID()}",
    existingStations: List<Station> = emptyList(),
): Station {
    val trimmedName = name.trim()
    if (trimmedName.isEmpty()) throw CustomStationValidationError.MissingName

    val trimmedStream = streamUrl.trim()
    if (trimmedStream.isEmpty()) throw CustomStationValidationError.MissingStreamUrl
    val streamUri = parseUri(trimmedStream) ?: throw CustomStationValidationError.InvalidStreamUrl
    if (streamUri.scheme?.lowercase() != "https") throw CustomStationValidationError.InsecureStreamUrl
    if (isPrivateOrLocalHost(streamUri.host)) throw CustomStationValidationError.PrivateStreamUrl
    findDuplicateStreamStation(existingStations, streamUri.toString())?.let {
        throw CustomStationValidationError.DuplicateStreamUrl(it.name)
    }

    val parsedHomepage = parseOptionalHomepage(homepage)
    val countryCode = country.trim().uppercase()
    if (countryCode.isNotEmpty() && !Regex("^[A-Z]{2}$").matches(countryCode)) {
        throw CustomStationValidationError.InvalidCountry
    }

    return Station(
        id = id,
        name = trimmedName,
        streamUrl = streamUri.toString(),
        homepage = parsedHomepage,
        country = countryCode.ifEmpty { null },
        tags = tags.split(",").map { it.trim().lowercase() }.filter { it.isNotEmpty() },
        status = StationStatus.StreamOnly,
    )
}

private fun parseOptionalHomepage(raw: String): String? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    val uri = parseUri(value) ?: throw CustomStationValidationError.InvalidHomepage
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") throw CustomStationValidationError.InvalidHomepage
    return uri.toString()
}

private fun parseUri(raw: String): URI? =
    runCatching { URI(raw).takeIf { it.scheme != null && it.host != null } }.getOrNull()

fun findDuplicateStreamStation(stations: List<Station>, streamUrl: String): Station? {
    val target = normalizedStreamUrl(streamUrl) ?: return null
    return stations.firstOrNull { normalizedStreamUrl(it.streamUrl) == target }
}

private fun normalizedStreamUrl(raw: String): String? {
    val uri = parseUri(raw)?.normalize() ?: return null
    val scheme = uri.scheme?.lowercase() ?: return null
    val host = uri.host?.lowercase() ?: return null
    val port = uri.port.takeUnless { it == defaultPort(scheme) }
    val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
    val trimmedPath = if (path.length > 1) path.trimEnd('/') else path
    val query = uri.rawQuery?.let { "?$it" }.orEmpty()
    return buildString {
        append(scheme)
        append("://")
        append(host)
        if (port != null && port > 0) append(":").append(port)
        append(trimmedPath)
        append(query)
    }
}

private fun defaultPort(scheme: String): Int? = when (scheme) {
    "http" -> 80
    "https" -> 443
    else -> null
}

private fun isPrivateOrLocalHost(host: String?): Boolean {
    val value = host?.lowercase()?.trim('[', ']') ?: return true
    if (value == "localhost" || value.endsWith(".local")) return true

    val ipv4 = value.split(".").mapNotNull { it.toIntOrNull() }
    if (ipv4.size == 4 && ipv4.all { it in 0..255 }) {
        return ipv4[0] == 10 ||
            ipv4[0] == 127 ||
            (ipv4[0] == 172 && ipv4[1] in 16..31) ||
            (ipv4[0] == 192 && ipv4[1] == 168) ||
            (ipv4[0] == 169 && ipv4[1] == 254) ||
            ipv4[0] == 0
    }

    return value == "::1" ||
        value == "::" ||
        value.startsWith("fe80:") ||
        value.startsWith("fc") ||
        value.startsWith("fd")
}
