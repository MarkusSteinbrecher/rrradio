package org.rrradio.android.playback

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

private const val MAX_PLAYLIST_BYTES = 128L * 1024L

class StreamUrlResolver(
    private val client: OkHttpClient = OkHttpClient(),
) {
    suspend fun resolve(streamUrl: String): String = withContext(Dispatchers.IO) {
        if (!shouldResolvePlaylistUrl(streamUrl)) return@withContext streamUrl

        try {
            val request = Request.Builder()
                .url(streamUrl)
                .header("Cache-Control", "no-store")
                .header("User-Agent", "rrradio-android/0.1")
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext streamUrl
                val body = response.body ?: return@withContext streamUrl
                val text = body.byteStream().use { input ->
                    input.readNBytes(MAX_PLAYLIST_BYTES.toInt()).decodeToString()
                }
                parsePlaylistStreamUrl(text, streamUrl) ?: streamUrl
            }
        } catch (_: IOException) {
            streamUrl
        } catch (_: IllegalArgumentException) {
            streamUrl
        }
    }
}

fun shouldResolvePlaylistUrl(streamUrl: String): Boolean {
    val path = streamUrl.substringBefore("?").lowercase()
    return path.endsWith(".pls") || (path.endsWith(".m3u") && !path.endsWith(".m3u8"))
}

fun parsePlaylistStreamUrl(text: String, playlistUrl: String): String? {
    val firstLine = text.lineSequence()
        .map { it.trim() }
        .firstOrNull { it.isNotEmpty() }
    val path = playlistUrl.substringBefore("?").lowercase()

    return when {
        firstLine.equals("[playlist]", ignoreCase = true) -> parsePlsPlaylist(text, playlistUrl)
        firstLine.equals("#EXTM3U", ignoreCase = true) -> parseM3uPlaylist(text, playlistUrl)
        path.endsWith(".pls") -> parsePlsPlaylist(text, playlistUrl)
        else -> parseM3uPlaylist(text, playlistUrl) ?: parsePlsPlaylist(text, playlistUrl)
    }
}

fun parseM3uPlaylist(text: String, playlistUrl: String): String? {
    val base = playlistUrl.toHttpUrlOrNull()
    return text.lineSequence()
        .map { it.trim() }
        .firstNotNullOfOrNull { line ->
            line.takeIf { it.isNotEmpty() && !it.startsWith("#") }
                ?.let { resolvePlaylistEntry(it, base) }
        }
}

fun parsePlsPlaylist(text: String, playlistUrl: String): String? {
    val base = playlistUrl.toHttpUrlOrNull()
    return text.lineSequence()
        .map { it.trim() }
        .firstNotNullOfOrNull { line ->
            val separator = line.indexOf('=')
            if (separator <= 0) return@firstNotNullOfOrNull null
            val key = line.substring(0, separator).trim().lowercase()
            if (!key.matches(Regex("file\\d*"))) return@firstNotNullOfOrNull null
            val value = line.substring(separator + 1).trim()
            value.takeIf { it.isNotEmpty() }?.let { resolvePlaylistEntry(it, base) }
        }
}

private fun resolvePlaylistEntry(value: String, base: HttpUrl?): String? {
    val absolute = value.toHttpUrlOrNull()
    if (absolute != null) return absolute.toString()
    return base?.resolve(value)?.toString()
}
