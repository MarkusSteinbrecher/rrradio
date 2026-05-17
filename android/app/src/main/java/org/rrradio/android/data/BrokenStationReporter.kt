package org.rrradio.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.rrradio.android.BuildConfig
import java.io.IOException
import java.net.URI

private const val BROKEN_STATION_ENDPOINT =
    "https://rrradio-stats.markussteinbrecher.workers.dev/api/public/report-broken"

class BrokenStationReporter(
    private val client: OkHttpClient = OkHttpClient(),
    private val endpoint: String = BROKEN_STATION_ENDPOINT,
) {
    suspend fun report(station: Station, reason: String?) {
        val payload = brokenStationReportPayload(
            station = station,
            reason = reason.orEmpty(),
            appVersion = BuildConfig.VERSION_NAME,
        )
        val body = defaultJson
            .encodeToString(payload)
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url(endpoint)
            .post(body)
            .build()

        withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("report failed: ${response.code}")
                }
            }
        }
    }
}

@Serializable
internal data class BrokenStationReportPayload(
    val stationId: String,
    val stationName: String,
    val streamHost: String,
    val platform: String,
    val appVersion: String,
    val reason: String,
    val source: String,
)

internal fun brokenStationReportPayload(
    station: Station,
    reason: String,
    appVersion: String,
): BrokenStationReportPayload =
    BrokenStationReportPayload(
        stationId = station.id,
        stationName = station.displayName(),
        streamHost = streamHost(station.streamUrl),
        platform = "android",
        appVersion = appVersion,
        reason = reason.take(160),
        source = "manual",
    )

internal fun streamHost(streamUrl: String): String =
    runCatching { URI(streamUrl).host.orEmpty() }.getOrDefault("")
