package org.rrradio.android.metadata

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.decodeFromString
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.rrradio.android.data.defaultJson
import java.io.IOException

data class ITunesCoverArtResult(
    val hit: Boolean,
    val coverUrl: String? = null,
    val appleMusicUrl: String? = null,
)

class ITunesCoverArtFetcher(
    private val client: OkHttpClient = OkHttpClient(),
    private val cacheLimit: Int = 64,
) {
    private val cache = LinkedHashMap<String, ITunesCoverArtResult>()

    fun search(artist: String?, title: String): ITunesCoverArtResult {
        val cleanedTitle = cleanITunesTrackComponent(title) ?: return ITunesCoverArtResult(hit = false)
        val key = iTunesCoverArtCacheKey(artist, cleanedTitle)
        cachedResult(key)?.let { return it }

        val url = iTunesSearchUrl(artist, cleanedTitle) ?: return ITunesCoverArtResult(hit = false)
        val request = Request.Builder()
            .url(url)
            .header("Cache-Control", "no-store")
            .header("User-Agent", "rrradio-android/0.1")
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val miss = ITunesCoverArtResult(hit = false)
                    rememberResult(key, miss)
                    return miss
                }

                val body = response.body?.string() ?: return ITunesCoverArtResult(hit = false)
                val payload = defaultJson.decodeFromString<ITunesSearchResponse>(body)
                val result = iTunesCoverArtResult(payload, artist, cleanedTitle)
                rememberResult(key, result)
                return result
            }
        } catch (_: IOException) {
            return ITunesCoverArtResult(hit = false)
        } catch (_: SerializationException) {
            return ITunesCoverArtResult(hit = false)
        }
    }

    @Synchronized
    private fun cachedResult(key: String): ITunesCoverArtResult? = cache[key]

    @Synchronized
    private fun rememberResult(key: String, result: ITunesCoverArtResult) {
        if (!cache.containsKey(key) && cache.size >= cacheLimit) {
            val oldest = cache.keys.firstOrNull()
            if (oldest != null) cache.remove(oldest)
        }
        cache[key] = result
    }
}

internal fun cleanITunesTrackComponent(value: String?): String? {
    val cleaned = cleanMetadataComponent(value) ?: return null
    return cleaned.takeIf { it.length >= 3 && it != "-" && it != "\u2014" }
}

internal fun iTunesCoverArtCacheKey(artist: String?, title: String): String =
    "${artist.orEmpty().lowercase().trim()}|${title.lowercase().trim()}"

internal fun iTunesSearchUrl(artist: String?, title: String): HttpUrl? {
    val cleanedTitle = cleanITunesTrackComponent(title) ?: return null
    val term = listOfNotNull(cleanMetadataComponent(artist), cleanedTitle)
        .joinToString(" ")
        .take(100)

    return "https://itunes.apple.com/search".toHttpUrl()
        .newBuilder()
        .addQueryParameter("term", term)
        .addQueryParameter("entity", "song")
        .addQueryParameter("limit", "5")
        .addQueryParameter("media", "music")
        .build()
}

internal fun iTunesCoverArtResult(
    payload: ITunesSearchResponse,
    artist: String?,
    title: String,
): ITunesCoverArtResult {
    val hit = payload.resultCount > 0
    val best = if (hit) pickBestITunesTrack(payload.results, artist, title) else null
    return ITunesCoverArtResult(
        hit = hit,
        coverUrl = best?.artworkUrl100?.let(::highResolutionITunesArtworkUrl),
        appleMusicUrl = best?.trackViewUrl?.takeIf { it.startsWith("https://") },
    )
}

internal fun pickBestITunesTrack(
    results: List<ITunesTrack>,
    artist: String?,
    title: String,
): ITunesTrack? {
    if (results.isEmpty()) return null
    val normalizedArtist = artist.orEmpty().lowercase().trim()
    val normalizedTitle = title.lowercase().trim()
    return results.firstOrNull { result ->
        val resultArtist = result.artistName.lowercase()
        val resultTitle = result.trackName.lowercase()
        val artistMatches = normalizedArtist.isEmpty() ||
            resultArtist.contains(normalizedArtist) ||
            normalizedArtist.contains(resultArtist)
        resultTitle.contains(normalizedTitle) && artistMatches
    } ?: results.first()
}

internal fun highResolutionITunesArtworkUrl(value: String): String =
    value.replace(Regex("/\\d+x\\d+bb\\.(jpg|jpeg|png)", RegexOption.IGNORE_CASE), "/600x600bb.$1")

internal fun isLowResolutionCoverUrl(value: String): Boolean {
    val lowercased = value.lowercase()
    return lowercased.contains("/medias/covers/m/") || lowercased.contains("/50/")
}

@Serializable
internal data class ITunesSearchResponse(
    val resultCount: Int = 0,
    val results: List<ITunesTrack> = emptyList(),
)

@Serializable
internal data class ITunesTrack(
    val artistName: String = "",
    val trackName: String = "",
    val artworkUrl100: String? = null,
    val trackViewUrl: String? = null,
)
