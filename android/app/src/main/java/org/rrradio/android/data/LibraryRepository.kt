package org.rrradio.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.rrradioDataStore by preferencesDataStore(name = "rrradio")

class LibraryRepository(
    context: Context,
    private val json: Json = defaultJson,
) {
    private val store = context.rrradioDataStore

    val favorites: Flow<List<Station>> = stationList(Keys.favorites)
    val recents: Flow<List<Station>> = stationList(Keys.recents)
    val customStations: Flow<List<Station>> = stationList(Keys.customStations)

    suspend fun toggleFavorite(station: Station): Boolean {
        var added = false
        store.edit { prefs ->
            val current = readStations(prefs[Keys.favorites])
            val next = if (current.any { it.id == station.id }) {
                current.filterNot { it.id == station.id }
            } else {
                added = true
                listOf(station) + current
            }
            prefs[Keys.favorites] = json.encodeToString(next)
        }
        return added
    }

    suspend fun pushRecent(station: Station) {
        store.edit { prefs ->
            val current = readStations(prefs[Keys.recents])
            prefs[Keys.recents] = json.encodeToString(
                (listOf(station) + current.filterNot { it.id == station.id }).take(RECENTS_LIMIT),
            )
        }
    }

    suspend fun addCustom(station: Station) {
        store.edit { prefs ->
            val current = readStations(prefs[Keys.customStations])
            val next = if (current.any { it.id == station.id }) {
                current.map { if (it.id == station.id) station else it }
            } else {
                listOf(station) + current
            }
            prefs[Keys.customStations] = json.encodeToString(next)
        }
    }

    suspend fun removeCustom(stationId: String) {
        store.edit { prefs ->
            prefs[Keys.customStations] = json.encodeToString(
                readStations(prefs[Keys.customStations]).filterNot { it.id == stationId },
            )
        }
    }

    private fun stationList(key: androidx.datastore.preferences.core.Preferences.Key<String>): Flow<List<Station>> =
        store.data.map { prefs -> readStations(prefs[key]) }

    private fun readStations(raw: String?): List<Station> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<Station>>(raw) }.getOrDefault(emptyList())
    }

    private object Keys {
        val favorites = stringPreferencesKey("rrradio.favorites.v2")
        val recents = stringPreferencesKey("rrradio.recents.v2")
        val customStations = stringPreferencesKey("rrradio.custom.v1")
    }

    companion object {
        const val RECENTS_LIMIT = 12
    }
}
