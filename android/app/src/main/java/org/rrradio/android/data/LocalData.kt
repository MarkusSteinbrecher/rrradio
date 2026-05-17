package org.rrradio.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.Locale

const val ANDROID_LIBRARY_SCHEMA_VERSION = 1
const val LISTENING_HISTORY_LIMIT = 100
const val DIAGNOSTIC_LOG_LIMIT = 200

enum class ListeningHistoryPreference(val rawValue: String) {
    Off("off"),
    Stations("stations"),
    Tracks("tracks"),
    ;

    companion object {
        fun fromRaw(rawValue: String?): ListeningHistoryPreference =
            entries.firstOrNull { it.rawValue == rawValue } ?: Off
    }
}

@Serializable
data class ListeningHistoryEntry(
    val playedAt: String,
    val stationId: String,
    val stationName: String,
    val trackArtist: String? = null,
    val trackTitle: String? = null,
)

@Serializable
data class DiagnosticLogEntry(
    val loggedAt: String,
    val category: String,
    val message: String,
)

@Serializable
data class LibraryBackupFile(
    val schemaVersion: Int = ANDROID_LIBRARY_SCHEMA_VERSION,
    val exportedAt: String,
    val platform: String = "android",
    val favorites: List<Station> = emptyList(),
    val customStations: List<Station> = emptyList(),
    val stationLists: List<StationList> = emptyList(),
    val preferences: LibraryBackupPreferences = LibraryBackupPreferences(),
)

@Serializable
data class LibraryBackupPreferences(
    val theme: String? = null,
    val accent: String? = null,
    val landingPage: String? = null,
    val favoritesDisplayMode: String? = null,
    val sleepDefaultMinutes: Int? = null,
    val listeningHistory: String? = null,
    val diagnosticsEnabled: Boolean? = null,
)

data class LibraryImportResult(
    val favoritesImported: Int,
    val customStationsImported: Int,
    val stationListsImported: Int,
    val preferencesImported: Boolean,
) {
    val summary: String
        get() {
            val parts = buildList {
                if (favoritesImported > 0) add("$favoritesImported favorites")
                if (customStationsImported > 0) add("$customStationsImported custom stations")
                if (stationListsImported > 0) add("$stationListsImported lists")
                if (preferencesImported) add("preferences")
            }
            return if (parts.isEmpty()) "Backup imported." else "Imported ${parts.joinToString(", ")}."
        }
}

@Serializable
data class DiagnosticsExportFile(
    val schemaVersion: Int = ANDROID_LIBRARY_SCHEMA_VERSION,
    val exportedAt: String,
    val platform: String = "android",
    val entries: List<DiagnosticLogEntry> = emptyList(),
)

fun buildLibraryBackupFile(
    favorites: List<Station>,
    customStations: List<Station>,
    stationLists: List<StationList>,
    preferences: LibraryBackupPreferences,
    exportedAt: String = Instant.now().toString(),
): LibraryBackupFile =
    LibraryBackupFile(
        exportedAt = exportedAt,
        favorites = favorites,
        customStations = customStations,
        stationLists = stationLists,
        preferences = preferences,
    )

fun decodeLibraryBackup(raw: String, json: Json = defaultJson): LibraryBackupFile {
    val backup = json.decodeFromString<LibraryBackupFile>(raw)
    require(backup.schemaVersion in 1..ANDROID_LIBRARY_SCHEMA_VERSION) {
        "Unsupported backup version"
    }
    return backup
}

fun buildDiagnosticsExportFile(
    entries: List<DiagnosticLogEntry>,
    exportedAt: String = Instant.now().toString(),
): DiagnosticsExportFile =
    DiagnosticsExportFile(
        exportedAt = exportedAt,
        entries = entries.take(DIAGNOSTIC_LOG_LIMIT),
    )

fun stationHistoryEntry(station: Station, playedAt: String = Instant.now().toString()): ListeningHistoryEntry =
    ListeningHistoryEntry(
        playedAt = playedAt,
        stationId = station.id,
        stationName = station.displayName(),
    )

fun diagnosticLogEntry(
    category: String,
    message: String,
    loggedAt: String = Instant.now().toString(),
): DiagnosticLogEntry =
    DiagnosticLogEntry(
        loggedAt = loggedAt,
        category = cleanDiagnosticCategory(category),
        message = cleanDiagnosticMessage(message),
    )

fun cappedListeningHistory(entries: List<ListeningHistoryEntry>): List<ListeningHistoryEntry> =
    entries.take(LISTENING_HISTORY_LIMIT)

fun cappedDiagnosticLog(entries: List<DiagnosticLogEntry>): List<DiagnosticLogEntry> =
    entries.take(DIAGNOSTIC_LOG_LIMIT)

private fun cleanDiagnosticCategory(raw: String): String {
    val token = raw
        .trim()
        .lowercase(Locale.US)
        .replace(Regex("[^a-z0-9_.-]+"), "-")
        .trim('-', '.', '_')
        .take(40)
    return token.ifBlank { "event" }
}

private fun cleanDiagnosticMessage(raw: String): String {
    val withoutUrls = raw.replace(Regex("https?://\\S+"), "[url]")
    return withoutUrls.trim().take(140).ifBlank { "event" }
}
