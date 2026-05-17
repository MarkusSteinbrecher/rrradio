package org.rrradio.android.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
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
    val favoritesDisplayMode: Flow<FavoritesDisplayMode> =
        store.data.map { prefs -> FavoritesDisplayMode.fromRaw(prefs[Keys.favoritesDisplayMode]) }
    val sleepDefaultMinutes: Flow<Int> =
        store.data.map { prefs -> normalizedSleepDefaultMinutes(prefs[Keys.sleepDefaultMinutes]) }
    val schemaVersion: Flow<Int> =
        store.data.map { prefs -> normalizedSchemaVersion(prefs[Keys.schemaVersion]) }
    val listeningHistoryPreference: Flow<ListeningHistoryPreference> =
        store.data.map { prefs -> ListeningHistoryPreference.fromRaw(prefs[Keys.listeningHistoryPreference]) }
    val listeningHistory: Flow<List<ListeningHistoryEntry>> =
        store.data.map { prefs -> readListeningHistory(prefs[Keys.listeningHistory]) }
    val diagnosticsEnabled: Flow<Boolean> =
        store.data.map { prefs -> prefs[Keys.diagnosticsEnabled] ?: false }
    val diagnosticLog: Flow<List<DiagnosticLogEntry>> =
        store.data.map { prefs -> readDiagnosticLog(prefs[Keys.diagnosticLog]) }

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

    suspend fun setFavoritesDisplayMode(mode: FavoritesDisplayMode) {
        store.edit { prefs ->
            prefs[Keys.favoritesDisplayMode] = mode.rawValue
        }
    }

    suspend fun setSleepDefaultMinutes(minutes: Int) {
        store.edit { prefs ->
            prefs[Keys.sleepDefaultMinutes] = normalizedSleepDefaultMinutes(minutes)
        }
    }

    suspend fun ensureCurrentSchemaVersion() {
        store.edit { prefs ->
            if (prefs[Keys.schemaVersion] != ANDROID_LIBRARY_SCHEMA_VERSION) {
                prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
            }
        }
    }

    suspend fun setListeningHistoryPreference(preference: ListeningHistoryPreference) {
        store.edit { prefs ->
            prefs[Keys.listeningHistoryPreference] = preference.rawValue
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
    }

    suspend fun clearListeningHistory() {
        store.edit { prefs ->
            prefs[Keys.listeningHistory] = json.encodeToString(emptyList<ListeningHistoryEntry>())
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
    }

    suspend fun setDiagnosticsEnabled(enabled: Boolean) {
        store.edit { prefs ->
            prefs[Keys.diagnosticsEnabled] = enabled
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
    }

    suspend fun clearDiagnostics() {
        store.edit { prefs ->
            prefs[Keys.diagnosticLog] = json.encodeToString(emptyList<DiagnosticLogEntry>())
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
    }

    suspend fun recordStationHistory(station: Station) {
        store.edit { prefs ->
            val preference = ListeningHistoryPreference.fromRaw(prefs[Keys.listeningHistoryPreference])
            if (preference == ListeningHistoryPreference.Off) return@edit
            val current = readListeningHistory(prefs[Keys.listeningHistory])
            prefs[Keys.listeningHistory] = json.encodeToString(
                cappedListeningHistory(listOf(stationHistoryEntry(station)) + current),
            )
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
    }

    suspend fun recordDiagnostic(category: String, message: String) {
        store.edit { prefs ->
            if (prefs[Keys.diagnosticsEnabled] != true) return@edit
            val current = readDiagnosticLog(prefs[Keys.diagnosticLog])
            prefs[Keys.diagnosticLog] = json.encodeToString(
                cappedDiagnosticLog(listOf(diagnosticLogEntry(category, message)) + current),
            )
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
    }

    suspend fun exportLibraryBackup(): String {
        val prefs = store.data.first()
        val backup = buildLibraryBackupFile(
            favorites = readStations(prefs[Keys.favorites]),
            customStations = readStations(prefs[Keys.customStations]),
            stationLists = readStationLists(prefs[Keys.stationLists]),
            preferences = LibraryBackupPreferences(
                theme = AppThemePreference.fromRaw(prefs[Keys.themePreference]).rawValue,
                accent = AccentPreference.fromRaw(prefs[Keys.accentPreference]).rawValue,
                landingPage = LandingPagePreference.fromRaw(prefs[Keys.landingPagePreference]).rawValue,
                favoritesDisplayMode = FavoritesDisplayMode.fromRaw(prefs[Keys.favoritesDisplayMode]).rawValue,
                sleepDefaultMinutes = normalizedSleepDefaultMinutes(prefs[Keys.sleepDefaultMinutes]),
                listeningHistory = ListeningHistoryPreference.fromRaw(prefs[Keys.listeningHistoryPreference]).rawValue,
                diagnosticsEnabled = prefs[Keys.diagnosticsEnabled] ?: false,
            ),
        )
        return json.encodeToString(backup)
    }

    suspend fun importLibraryBackup(raw: String): LibraryImportResult {
        val backup = decodeLibraryBackup(raw, json)
        val result = LibraryImportResult(
            favoritesImported = backup.favorites.size,
            customStationsImported = backup.customStations.size,
            stationListsImported = backup.stationLists.size,
            preferencesImported = backup.preferences.hasAnyValue(),
        )

        store.edit { prefs ->
            prefs[Keys.favorites] = json.encodeToString(
                uniqueStations(backup.favorites + readStations(prefs[Keys.favorites])),
            )
            prefs[Keys.customStations] = json.encodeToString(
                uniqueStations(backup.customStations + readStations(prefs[Keys.customStations])),
            )
            prefs[Keys.stationLists] = json.encodeToString(
                mergeStationLists(
                    current = readStationLists(prefs[Keys.stationLists]),
                    imported = backup.stationLists,
                ),
            )
            backup.preferences.theme?.let { prefs[Keys.themePreference] = AppThemePreference.fromRaw(it).rawValue }
            backup.preferences.accent?.let { prefs[Keys.accentPreference] = AccentPreference.fromRaw(it).rawValue }
            backup.preferences.landingPage?.let {
                prefs[Keys.landingPagePreference] = LandingPagePreference.fromRaw(it).rawValue
            }
            backup.preferences.favoritesDisplayMode?.let {
                prefs[Keys.favoritesDisplayMode] = FavoritesDisplayMode.fromRaw(it).rawValue
            }
            backup.preferences.sleepDefaultMinutes?.let {
                prefs[Keys.sleepDefaultMinutes] = normalizedSleepDefaultMinutes(it)
            }
            backup.preferences.listeningHistory?.let {
                prefs[Keys.listeningHistoryPreference] = ListeningHistoryPreference.fromRaw(it).rawValue
            }
            backup.preferences.diagnosticsEnabled?.let { prefs[Keys.diagnosticsEnabled] = it }
            prefs[Keys.schemaVersion] = ANDROID_LIBRARY_SCHEMA_VERSION
        }
        return result
    }

    suspend fun exportDiagnostics(): String {
        val prefs = store.data.first()
        return json.encodeToString(buildDiagnosticsExportFile(readDiagnosticLog(prefs[Keys.diagnosticLog])))
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

    private fun readListeningHistory(raw: String?): List<ListeningHistoryEntry> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<ListeningHistoryEntry>>(raw) }.getOrDefault(emptyList())
    }

    private fun readDiagnosticLog(raw: String?): List<DiagnosticLogEntry> {
        if (raw.isNullOrBlank()) return emptyList()
        return runCatching { json.decodeFromString<List<DiagnosticLogEntry>>(raw) }.getOrDefault(emptyList())
    }

    private fun mergeStationLists(current: List<StationList>, imported: List<StationList>): List<StationList> {
        val cleanedImported = imported
            .filter { it.id.isNotBlank() }
            .map { list ->
                list.copy(
                    name = cleanedStationListName(list.name),
                    stations = uniqueStations(list.stations),
                )
            }
        val importedIds = cleanedImported.mapTo(mutableSetOf()) { it.id }
        return cleanedImported + current.filterNot { it.id in importedIds }
    }

    private fun LibraryBackupPreferences.hasAnyValue(): Boolean =
        theme != null ||
            accent != null ||
            landingPage != null ||
            favoritesDisplayMode != null ||
            sleepDefaultMinutes != null ||
            listeningHistory != null ||
            diagnosticsEnabled != null

    private object Keys {
        val schemaVersion = intPreferencesKey("rrradio.schema-version.v1")
        val favorites = stringPreferencesKey("rrradio.favorites.v2")
        val recents = stringPreferencesKey("rrradio.recents.v2")
        val customStations = stringPreferencesKey("rrradio.custom.v1")
        val stationLists = stringPreferencesKey("rrradio.station-lists.v1")
        val themePreference = stringPreferencesKey("rrradio.theme-preference.v1")
        val accentPreference = stringPreferencesKey("rrradio.accent-preference.v1")
        val landingPagePreference = stringPreferencesKey("rrradio.landing-page.v1")
        val favoritesDisplayMode = stringPreferencesKey("rrradio.favorites-display-mode.v1")
        val sleepDefaultMinutes = intPreferencesKey("rrradio.sleep-default-minutes.v1")
        val listeningHistoryPreference = stringPreferencesKey("rrradio.listening-history-preference.v1")
        val listeningHistory = stringPreferencesKey("rrradio.listening-history.v1")
        val diagnosticsEnabled = booleanPreferencesKey("rrradio.diagnostics-enabled.v1")
        val diagnosticLog = stringPreferencesKey("rrradio.diagnostic-log.v1")
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

        fun normalizedSchemaVersion(version: Int?): Int =
            version?.takeIf { it in 1..ANDROID_LIBRARY_SCHEMA_VERSION } ?: ANDROID_LIBRARY_SCHEMA_VERSION
    }
}
