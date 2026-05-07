package org.rrradio.android.data

import java.net.URI
import java.util.UUID

sealed class CustomStationValidationError(message: String) : IllegalArgumentException(message) {
    data object MissingName : CustomStationValidationError("Name is required.")
    data object MissingStreamUrl : CustomStationValidationError("Stream URL is required.")
    data object InvalidStreamUrl : CustomStationValidationError("Stream URL must be a valid URL.")
    data object InsecureStreamUrl : CustomStationValidationError("Stream URL must use https://.")
    data object InvalidHomepage : CustomStationValidationError("Homepage must be a valid http:// or https:// URL.")
    data object InvalidCountry : CustomStationValidationError("Country must be a 2-letter code, for example CH.")
}

fun makeCustomStation(
    name: String,
    streamUrl: String,
    homepage: String = "",
    country: String = "",
    tags: String = "",
    id: String = "custom-${UUID.randomUUID()}",
): Station {
    val trimmedName = name.trim()
    if (trimmedName.isEmpty()) throw CustomStationValidationError.MissingName

    val trimmedStream = streamUrl.trim()
    if (trimmedStream.isEmpty()) throw CustomStationValidationError.MissingStreamUrl
    val streamUri = parseUri(trimmedStream) ?: throw CustomStationValidationError.InvalidStreamUrl
    if (streamUri.scheme?.lowercase() != "https") throw CustomStationValidationError.InsecureStreamUrl

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
