package org.rrradio.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

private val Context.rrradioDataStore by preferencesDataStore(name = "rrradio")

class LibraryRepository(
    context: Context,
    private val json: Json = defaultJson,
) {
    private val store = context.rrradioDataStore

    val favorites: Flow<List<Station>> = stationList(Keys.favorites)
    val recents: Flow<List<Station>> = stationList(Keys.recents)
    val customStations: Flow<List<Station>> = stationList(Keys.customStations)
    val stationLists: Flow<List<StationList>> = store.data.map { prefs -> readStationLists(prefs[Keys.stationLists]) }
    val themePreference: Flow<AppThemePreference> =
        store.data.map { prefs -> AppThemePreference.fromRaw(prefs[Keys.themePreference]) }
    val accentPreference: Flow<AccentPreference> =
        store.data.map { prefs -> AccentPreference.fromRaw(prefs[Keys.accentPreference]) }
    val landingPagePreference: Flow<LandingPagePreference> =
        store.data.map { prefs -> LandingPagePreference.fromRaw(prefs[Keys.landingPagePreference]) }
    val sleepDefaultMinutes: Flow<Int> =
        store.data.map { prefs -> normalizedSleepDefaultMinutes(prefs[Keys.sleepDefaultMinutes]) }

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

    suspend fun addFavorite(station: Station): Boolean {
        var added = false
        store.edit { prefs ->
            val current = readStations(prefs[Keys.favorites])
            val next = if (current.any { it.id == station.id }) {
                current.map { if (it.id == station.id) station else it }
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
            prefs[Keys.favorites] = json.encodeToString(
                readStations(prefs[Keys.favorites]).filterNot { it.id == stationId },
            )
            prefs[Keys.recents] = json.encodeToString(
                readStations(prefs[Keys.recents]).filterNot { it.id == stationId },
            )
            prefs[Keys.stationLists] = json.encodeToString(
                readStationLists(prefs[Keys.stationLists]).map { list ->
                    list.copy(stations = list.stations.filterNot { it.id == stationId })
                },
            )
        }
    }

    suspend fun createStationList(name: String, stations: List<Station> = emptyList()): StationList {
        val list = StationList(
            id = UUID.randomUUID().toString(),
            name = cleanedStationListName(name),
            stations = uniqueStations(stations),
        )
        store.edit { prefs ->
            val current = readStationLists(prefs[Keys.stationLists])
            prefs[Keys.stationLists] = json.encodeToString(listOf(list) + current)
        }
        return list
    }

    suspend fun removeStationList(listId: String) {
        store.edit { prefs ->
            prefs[Keys.stationLists] = json.encodeToString(
                readStationLists(prefs[Keys.stationLists]).filterNot { it.id == listId },
            )
        }
    }

    suspend fun renameStationList(listId: String, name: String) {
        val cleanedName = cleanedStationListName(name)
        store.edit { prefs ->
            prefs[Keys.stationLists] = json.encodeToString(
                readStationLists(prefs[Keys.stationLists]).map { list ->
                    if (list.id == listId) list.copy(name = cleanedName) else list
                },
            )
        }
    }

    suspend fun addStationsToList(listId: String, stations: List<Station>) {
        if (stations.isEmpty()) return
        store.edit { prefs ->
            prefs[Keys.stationLists] = json.encodeToString(
                readStationLists(prefs[Keys.stationLists]).map { list ->
                    if (list.id == listId) {
                        list.copy(stations = uniqueStations(stations + list.stations))
                    } else {
                        list
                    }
                },
            )
        }
    }

    suspend fun removeStationFromList(listId: String, stationId: String) {
        store.edit { prefs ->
            prefs[Keys.stationLists] = json.encodeToString(
                readStationLists(prefs[Keys.stationLists]).map { list ->
                    if (list.id == listId) {
                        list.copy(stations = list.stations.filterNot { it.id == stationId })
                    } else {
                        list
                    }
                },
            )
        }
    }

    suspend fun reorderStationLists(orderedIds: List<String>) {
        store.edit { prefs ->
            prefs[Keys.stationLists] = json.encodeToString(
                reorderedStationLists(readStationLists(prefs[Keys.stationLists]), orderedIds),
            )
        }
    }

    suspend fun reorderStationsInList(listId: String, orderedIds: List<String>) {
        store.edit { prefs ->
            prefs[Keys.stationLists] = json.encodeToString(
                readStationLists(prefs[Keys.stationLists]).map { list ->
                    if (list.id == listId) {
                        list.copy(stations = reorderedStations(list.stations, orderedIds))
                    } else {
                        list
                    }
                },
            )
        }
    }

    suspend fun reorderFavorites(orderedIds: List<String>) {
        store.edit { prefs ->
            prefs[Keys.favorites] = json.encodeToString(
                reorderedStations(readStations(prefs[Keys.favorites]), orderedIds),
            )
        }
    }

    suspend fun setThemePreference(preference: AppThemePreference) {
        store.edit { prefs ->
            prefs[Keys.themePreference] = preference.rawValue
        }
    }

    suspend fun setAccentPreference(preference: AccentPreference) {
        store.edit { prefs ->
            prefs[Keys.accentPreference] = preference.rawValue
        }
    }

    suspend fun setLandingPagePreference(preference: LandingPagePreference) {
        store.edit { prefs ->
            prefs[Keys.landingPagePreference] = preference.rawValue
        }
    }

    suspend fun setSleepDefaultMinutes(minutes: Int) {
        store.edit { prefs ->
            prefs[Keys.sleepDefaultMinutes] = normalizedSleepDefaultMinutes(minutes)
        }
    }

    private fun stationList(key: androidx.datastore.preferences.core.Preferences.Key<String>): Flow<List<Station>> =
        store.data.map { prefs -> readStations(prefs[key]) }

    private fun readStations(raw: String?): List<Station> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<Station>>(raw) }.getOrDefault(emptyList())
    }

    private fun readStationLists(raw: String?): List<StationList> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<StationList>>(raw) }.getOrDefault(emptyList())
    }

    private object Keys {
        val favorites = stringPreferencesKey("rrradio.favorites.v2")
        val recents = stringPreferencesKey("rrradio.recents.v2")
        val customStations = stringPreferencesKey("rrradio.custom.v1")
        val stationLists = stringPreferencesKey("rrradio.station-lists.v1")
        val themePreference = stringPreferencesKey("rrradio.theme-preference.v1")
        val accentPreference = stringPreferencesKey("rrradio.accent-preference.v1")
        val landingPagePreference = stringPreferencesKey("rrradio.landing-page.v1")
        val sleepDefaultMinutes = intPreferencesKey("rrradio.sleep-default-minutes.v1")
    }

    companion object {
        const val RECENTS_LIMIT = 12
        const val DEFAULT_SLEEP_MINUTES = 30
        val SLEEP_DEFAULT_OPTIONS = listOf(15, 30, 60, 90)
        private const val FALLBACK_STATION_LIST_NAME = "Station List"

        fun cleanedStationListName(name: String): String =
            name.trim().ifEmpty { FALLBACK_STATION_LIST_NAME }

        fun uniqueStations(stations: List<Station>): List<Station> {
            val seen = mutableSetOf<String>()
            return stations.filter { seen.add(it.id) }
        }

        fun reorderedStations(stations: List<Station>, orderedIds: List<String>): List<Station> {
            val byId = stations.associateBy { it.id }
            val next = mutableListOf<Station>()
            val seen = mutableSetOf<String>()
            orderedIds.forEach { id ->
                val station = byId[id]
                if (station != null && seen.add(id)) next.add(station)
            }
            next.addAll(stations.filterNot { it.id in seen })
            return next
        }

        fun reorderedStationLists(stationLists: List<StationList>, orderedIds: List<String>): List<StationList> {
            val byId = stationLists.associateBy { it.id }
            val next = mutableListOf<StationList>()
            val seen = mutableSetOf<String>()
            orderedIds.forEach { id ->
                val list = byId[id]
                if (list != null && seen.add(id)) next.add(list)
            }
            next.addAll(stationLists.filterNot { it.id in seen })
            return next
        }

        fun normalizedSleepDefaultMinutes(minutes: Int?): Int =
            minutes?.takeIf { it in SLEEP_DEFAULT_OPTIONS } ?: DEFAULT_SLEEP_MINUTES
    }
}
