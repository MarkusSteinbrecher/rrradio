package org.rrradio.android.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

class CatalogRepository(
    private val context: Context,
    private val client: OkHttpClient = OkHttpClient(),
    private val json: Json = defaultJson,
    private val catalogUrl: String = CANONICAL_CATALOG_URL,
) {
    private val cacheFile: File
        get() = File(context.cacheDir, "stations.json")

    suspend fun load(): CatalogState = withContext(Dispatchers.IO) {
        val cached = readCache()
        val initial = if (cached.isNotEmpty()) {
            CatalogState(stations = cached, loadState = CatalogLoadState.Loaded)
        } else {
            CatalogState(loadState = CatalogLoadState.Loading)
        }

        try {
            val request = Request.Builder()
                .url(catalogUrl)
                .cacheControl(okhttp3.CacheControl.FORCE_NETWORK)
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("Catalog returned HTTP ${response.code}")
                val body = response.body?.string() ?: error("Catalog response was empty")
                val parsed = decodeCatalogStations(body, json)
                cacheFile.writeText(body)
                CatalogState(stations = parsed, loadState = CatalogLoadState.Loaded)
            }
        } catch (error: Exception) {
            if (initial.stations.isNotEmpty()) {
                initial
            } else {
                CatalogState(
                    loadState = CatalogLoadState.Failed,
                    errorMessage = catalogErrorMessage(error),
                )
            }
        }
    }

    fun readCache(): List<Station> {
        val file = cacheFile
        if (!file.exists()) return emptyList()
        return runCatching {
            decodeCatalogStations(file.readText(), json)
        }.getOrDefault(emptyList())
    }

    companion object {
        const val CANONICAL_CATALOG_URL = "https://rrradio.org/stations.json"
    }
}

internal fun decodeCatalogStations(raw: String, json: Json = defaultJson): List<Station> {
    val root = json.parseToJsonElement(raw)
    return when (root) {
        is JsonObject -> json.decodeFromJsonElement<CatalogResponse>(root).stations
        is JsonArray -> json.decodeFromJsonElement<List<Station>>(root)
        else -> throw SerializationException("Catalog root must be an object or an array")
    }
}

private fun catalogErrorMessage(error: Exception): String =
    when (error) {
        is SerializationException -> "Catalog data could not be read."
        else -> error.localizedMessage ?: "Catalog unavailable"
    }

val defaultJson: Json = Json {
    ignoreUnknownKeys = true
}
