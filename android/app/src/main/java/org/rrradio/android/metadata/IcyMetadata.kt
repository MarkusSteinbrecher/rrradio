package org.rrradio.android.metadata

import org.rrradio.android.data.NowPlayingMetadata
import org.rrradio.android.data.Station
import org.rrradio.android.data.StationStatus
import okhttp3.OkHttpClient
import okhttp3.Request
import java.nio.charset.Charset

fun parseStreamTitle(raw: String): NowPlayingMetadata? {
    val value = Regex("StreamTitle='([^']*)'").find(raw)?.groupValues?.getOrNull(1)
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: return null
    val parts = value.split(" - ", limit = 2)
    return if (parts.size == 2) {
        NowPlayingMetadata(artist = parts[0].trim(), title = parts[1].trim(), raw = value)
    } else {
        NowPlayingMetadata(title = value, raw = value)
    }
}

class IcyMetadataFetcher(
    private val client: OkHttpClient = OkHttpClient(),
) {
    fun supports(station: Station): Boolean = station.status == StationStatus.IcyOnly

    fun fetch(station: Station): NowPlayingMetadata? {
        val request = Request.Builder()
            .url(station.streamUrl)
            .header("Icy-MetaData", "1")
            .header("User-Agent", "rrradio-android/0.1")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val metaint = response.header("icy-metaint")?.toIntOrNull()
            val source = response.body?.source() ?: return null

            if (metaint != null && metaint > 0) {
                source.skip(metaint.toLong())
                val lengthByte = source.readByte().toInt() and 0xff
                if (lengthByte <= 0) return null
                val metadataBytes = source.readByteArray((lengthByte * 16).toLong())
                return parseStreamTitle(metadataBytes.decode())
            }

            val sniff = source.readByteArray(32_768)
            return parseStreamTitle(sniff.decode())
        }
    }
}

private fun ByteArray.decode(): String =
    runCatching { toString(Charsets.UTF_8) }
        .getOrElse { toString(Charset.forName("ISO-8859-1")) }
