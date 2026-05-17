package org.rrradio.android.metadata

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.rrradio.android.data.NowPlayingMetadata
import org.rrradio.android.data.Station
import org.rrradio.android.data.defaultJson
import java.io.IOException

class BroadcasterMetadataFetcher(
    private val client: OkHttpClient = OkHttpClient(),
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
) {
    fun supports(station: Station): Boolean =
        station.metadata == "grrif" || station.metadata == "orf" || isFm4Stream(station)

    fun fetch(station: Station): NowPlayingMetadata? = when {
        station.metadata == "grrif" -> fetchGrrifMetadata(client, nowMillis)
        station.metadata == "orf" || isFm4Stream(station) -> fetchOrfMetadata(station, client, nowMillis)
        else -> null
    }
}

internal fun parseGrrifMetadata(json: String): NowPlayingMetadata? =
    parseGrrifMetadata(defaultJson.decodeFromString<List<GrrifTrack>>(json))

internal fun parseGrrifMetadata(tracks: List<GrrifTrack>): NowPlayingMetadata? {
    val latest = tracks.lastOrNull() ?: return null
    val title = cleanMetadataComponent(latest.title) ?: return null
    val artist = cleanMetadataComponent(latest.artist)

    return NowPlayingMetadata(
        artist = artist?.let(::metadataTitleCase),
        title = metadataTitleCase(title),
        raw = metadataRaw(artist, title),
        coverUrl = grrifCoverUrl(latest.coverPath),
    )
}

internal fun parseOrfMetadata(
    liveJson: String,
    detailJson: String,
    nowMillis: Long,
): NowPlayingMetadata? =
    parseOrfMetadata(
        live = defaultJson.decodeFromString<List<OrfBroadcast>>(liveJson),
        detail = defaultJson.decodeFromString<OrfDetail>(detailJson),
        nowMillis = nowMillis,
    )

internal fun parseOrfMetadata(
    live: List<OrfBroadcast>,
    detail: OrfDetail,
    nowMillis: Long,
): NowPlayingMetadata? {
    val current = live.firstOrNull { it.start <= nowMillis && nowMillis < it.end } ?: return null
    val programName = cleanMetadataComponent(current.title)
    val programSubtitle = stripMetadataHtml(current.subtitle)
    val item = detail.items.orEmpty().firstOrNull { item ->
        val start = item.start ?: return@firstOrNull false
        val duration = item.duration ?: return@firstOrNull false
        start <= nowMillis && nowMillis < start + duration
    }

    val title = cleanMetadataComponent(item?.title)
    if (item?.type != "M" || title == null) {
        return programName?.let {
            NowPlayingMetadata(
                raw = "",
                programName = it,
                programSubtitle = programSubtitle,
            )
        }
    }

    val artist = cleanMetadataComponent(item.interpreter)
    return NowPlayingMetadata(
        artist = artist,
        title = title,
        raw = metadataRaw(artist, title),
        programName = programName,
        programSubtitle = programSubtitle,
        coverUrl = bestOrfImage(item.images),
    )
}

private fun fetchGrrifMetadata(
    client: OkHttpClient,
    nowMillis: () -> Long,
): NowPlayingMetadata? {
    val url = "https://www.grrif.ch/live/covers.json".toHttpUrl()
        .newBuilder()
        .addQueryParameter("_", (nowMillis() / 1000).toString())
        .build()
    val request = metadataRequest(url.toString())
    val body = executeMetadataRequest(client, request) ?: return null
    return runCatching { parseGrrifMetadata(body) }.getOrNull()
}

private fun fetchOrfMetadata(
    station: Station,
    client: OkHttpClient,
    nowMillis: () -> Long,
): NowPlayingMetadata? {
    val liveUrl = cleanMetadataComponent(station.metadataUrl)
        ?: if (isFm4Stream(station)) FM4_METADATA_URL else return null
    val liveBody = executeMetadataRequest(client, metadataRequest(liveUrl)) ?: return null
    val live = runCatching { defaultJson.decodeFromString<List<OrfBroadcast>>(liveBody) }.getOrNull()
        ?: return null
    val current = live.firstOrNull { it.start <= nowMillis() && nowMillis() < it.end } ?: return null
    val detailBody = executeMetadataRequest(client, metadataRequest(current.href)) ?: return null

    return try {
        parseOrfMetadata(
            live = live,
            detail = defaultJson.decodeFromString(detailBody),
            nowMillis = nowMillis(),
        )
    } catch (_: SerializationException) {
        null
    }
}

private fun executeMetadataRequest(client: OkHttpClient, request: Request): String? =
    try {
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }
    } catch (_: IOException) {
        null
    }

private fun metadataRequest(url: String): Request =
    Request.Builder()
        .url(url)
        .header("Cache-Control", "no-store")
        .header("User-Agent", "rrradio-android/0.1")
        .build()

internal fun grrifCoverUrl(value: String?): String? {
    val cover = cleanMetadataComponent(value)
        ?.takeUnless { Regex("/default\\.jpg$", RegexOption.IGNORE_CASE).containsMatchIn(it) }
        ?: return null
    if (cover.startsWith("https://") || cover.startsWith("http://")) return cover
    return "https://www.grrif.ch".toHttpUrl().resolve(cover)?.toString()
}

internal fun bestOrfImage(images: List<OrfImage>?): String? =
    images?.firstOrNull()
        ?.versions
        ?.maxByOrNull { it.width ?: 0 }
        ?.path

private fun isFm4Stream(station: Station): Boolean =
    Regex("orf-live\\.ors-shoutcast\\.at/fm4-", RegexOption.IGNORE_CASE).containsMatchIn(station.streamUrl)

private const val FM4_METADATA_URL = "https://audioapi.orf.at/fm4/api/json/4.0/live"

@Serializable
internal data class GrrifTrack(
    @SerialName("Title")
    val title: String? = null,
    @SerialName("Artist")
    val artist: String? = null,
    @SerialName("URLCover")
    val coverPath: String? = null,
)

@Serializable
internal data class OrfBroadcast(
    val start: Long,
    val end: Long,
    val href: String,
    val title: String? = null,
    val subtitle: String? = null,
)

@Serializable
internal data class OrfDetail(
    val items: List<OrfItem>? = null,
)

@Serializable
internal data class OrfItem(
    val type: String? = null,
    val start: Long? = null,
    val duration: Long? = null,
    val title: String? = null,
    val interpreter: String? = null,
    val images: List<OrfImage>? = null,
)

@Serializable
internal data class OrfImage(
    val versions: List<OrfImageVersion>? = null,
)

@Serializable
internal data class OrfImageVersion(
    val path: String? = null,
    val width: Int? = null,
)
