package org.rrradio.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

sealed class StreamProbeResult {
    data object Playable : StreamProbeResult()
    data class Failed(val message: String) : StreamProbeResult()
}

class StreamProbe(
    private val client: OkHttpClient = OkHttpClient(),
) {
    suspend fun verify(streamUrl: String): StreamProbeResult = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(streamUrl)
            .header("Range", "bytes=0-1023")
            .header("User-Agent", "rrradio-android/0.1")
            .build()

        val result = runCatching {
            client.newCall(request).execute().use { response ->
                when {
                    !response.isSuccessful -> StreamProbeResult.Failed("Stream returned HTTP ${response.code}.")
                    !looksLikePlayableStream(response.header("Content-Type"), streamUrl) ->
                        StreamProbeResult.Failed("Stream did not look like playable audio.")
                    else -> StreamProbeResult.Playable
                }
            }
        }
        result.getOrElse {
            StreamProbeResult.Failed("Stream could not be reached.")
        }
    }
}

fun looksLikePlayableStream(contentType: String?, streamUrl: String): Boolean {
    val type = contentType?.substringBefore(";")?.trim()?.lowercase().orEmpty()
    if (type.startsWith("audio/")) return true
    if (type in playableContentTypes) return true

    val path = streamUrl.substringBefore("?").lowercase()
    return playableExtensions.any { path.endsWith(it) }
}

private val playableContentTypes = setOf(
    "application/aac",
    "application/mpegurl",
    "application/octet-stream",
    "application/ogg",
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "binary/octet-stream",
)

private val playableExtensions = setOf(
    ".aac",
    ".m3u",
    ".m3u8",
    ".mp3",
    ".oga",
    ".ogg",
    ".pls",
)
