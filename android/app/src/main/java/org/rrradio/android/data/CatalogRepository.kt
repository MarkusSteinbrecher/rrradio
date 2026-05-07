package org.rrradio.android.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
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
                val parsed = json.decodeFromString<CatalogResponse>(body).stations
                cacheFile.writeText(body)
                CatalogState(stations = parsed, loadState = CatalogLoadState.Loaded)
            }
        } catch (error: Exception) {
            if (initial.stations.isNotEmpty()) {
                initial
            } else {
                CatalogState(
                    loadState = CatalogLoadState.Failed,
                    errorMessage = error.localizedMessage ?: "Catalog unavailable",
                )
            }
        }
    }

    fun readCache(): List<Station> {
        val file = cacheFile
        if (!file.exists()) return emptyList()
        return runCatching {
            json.decodeFromString<CatalogResponse>(file.readText()).stations
        }.getOrDefault(emptyList())
    }

    companion object {
        const val CANONICAL_CATALOG_URL = "https://rrradio.org/stations.json"
    }
}

val defaultJson: Json = Json {
    ignoreUnknownKeys = true
}
