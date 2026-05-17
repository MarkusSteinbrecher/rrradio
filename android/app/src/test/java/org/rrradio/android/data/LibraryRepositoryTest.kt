package org.rrradio.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LibraryRepositoryTest {
    @Test
    fun themePreferenceFallsBackToSystemForUnknownRawValue() {
        assertEquals(AppThemePreference.System, AppThemePreference.fromRaw(null))
        assertEquals(AppThemePreference.System, AppThemePreference.fromRaw("unknown"))
    }

    @Test
    fun themePreferenceResolvesSystemAgainstDeviceTheme() {
        assertEquals(false, AppThemePreference.System.resolvedDarkTheme(systemDarkTheme = false))
        assertEquals(true, AppThemePreference.System.resolvedDarkTheme(systemDarkTheme = true))
        assertEquals(false, AppThemePreference.Light.resolvedDarkTheme(systemDarkTheme = true))
        assertEquals(true, AppThemePreference.Dark.resolvedDarkTheme(systemDarkTheme = false))
    }

    @Test
    fun accentPreferenceFallsBackToClassicForUnknownRawValue() {
        assertEquals(AccentPreference.Classic, AccentPreference.fromRaw(null))
        assertEquals(AccentPreference.Classic, AccentPreference.fromRaw("unknown"))
        assertEquals(AccentPreference.Blue, AccentPreference.fromRaw("blue"))
    }

    @Test
    fun landingPagePreferenceFallsBackToBrowseForUnknownRawValue() {
        assertEquals(LandingPagePreference.Browse, LandingPagePreference.fromRaw(null))
        assertEquals(LandingPagePreference.Browse, LandingPagePreference.fromRaw("unknown"))
        assertEquals(LandingPagePreference.Favorites, LandingPagePreference.fromRaw("favorites"))
    }

    @Test
    fun favoritesDisplayModeFallsBackToListForUnknownRawValue() {
        assertEquals(FavoritesDisplayMode.List, FavoritesDisplayMode.fromRaw(null))
        assertEquals(FavoritesDisplayMode.List, FavoritesDisplayMode.fromRaw("unknown"))
        assertEquals(FavoritesDisplayMode.Tiles, FavoritesDisplayMode.fromRaw("tiles"))
        assertEquals(FavoritesDisplayMode.App, FavoritesDisplayMode.fromRaw("app"))
    }

    @Test
    fun listeningHistoryPreferenceDefaultsToOff() {
        assertEquals(ListeningHistoryPreference.Off, ListeningHistoryPreference.fromRaw(null))
        assertEquals(ListeningHistoryPreference.Off, ListeningHistoryPreference.fromRaw("unknown"))
        assertEquals(ListeningHistoryPreference.Stations, ListeningHistoryPreference.fromRaw("stations"))
        assertEquals(ListeningHistoryPreference.Tracks, ListeningHistoryPreference.fromRaw("tracks"))
    }

    @Test
    fun sleepDefaultMinutesUsesSupportedValuesOnly() {
        assertEquals(30, LibraryRepository.normalizedSleepDefaultMinutes(null))
        assertEquals(30, LibraryRepository.normalizedSleepDefaultMinutes(0))
        assertEquals(15, LibraryRepository.normalizedSleepDefaultMinutes(15))
        assertEquals(90, LibraryRepository.normalizedSleepDefaultMinutes(90))
    }

    @Test
    fun schemaVersionUsesCurrentVersionForMissingOrUnknownValues() {
        assertEquals(ANDROID_LIBRARY_SCHEMA_VERSION, LibraryRepository.normalizedSchemaVersion(null))
        assertEquals(ANDROID_LIBRARY_SCHEMA_VERSION, LibraryRepository.normalizedSchemaVersion(0))
        assertEquals(ANDROID_LIBRARY_SCHEMA_VERSION, LibraryRepository.normalizedSchemaVersion(99))
        assertEquals(ANDROID_LIBRARY_SCHEMA_VERSION, LibraryRepository.normalizedSchemaVersion(1))
    }

    @Test
    fun uniqueStationsKeepsFirstOccurrence() {
        val first = station("first")
        val duplicate = station("first", name = "Duplicate")
        val second = station("second")

        val result = LibraryRepository.uniqueStations(listOf(first, duplicate, second))

        assertEquals(listOf(first, second), result)
    }

    @Test
    fun reorderedStationsKeepsUnknownStationsAtEnd() {
        val first = station("first")
        val second = station("second")
        val third = station("third")

        val result = LibraryRepository.reorderedStations(
            stations = listOf(first, second, third),
            orderedIds = listOf("second", "missing", "first"),
        )

        assertEquals(listOf(second, first, third), result)
    }

    @Test
    fun reorderedStationListsKeepsUnknownListsAtEnd() {
        val first = stationList("first")
        val second = stationList("second")
        val third = stationList("third")

        val result = LibraryRepository.reorderedStationLists(
            stationLists = listOf(first, second, third),
            orderedIds = listOf("second", "missing", "first"),
        )

        assertEquals(listOf(second, first, third), result)
    }

    @Test
    fun libraryBackupRoundTripsSupportedSchema() {
        val backup = buildLibraryBackupFile(
            favorites = listOf(station("fm4")),
            customStations = listOf(station("custom")),
            stationLists = listOf(stationList("morning")),
            preferences = LibraryBackupPreferences(
                theme = AppThemePreference.Dark.rawValue,
                accent = AccentPreference.Yellow.rawValue,
                landingPage = LandingPagePreference.Favorites.rawValue,
                favoritesDisplayMode = FavoritesDisplayMode.App.rawValue,
                sleepDefaultMinutes = 60,
                listeningHistory = ListeningHistoryPreference.Stations.rawValue,
                diagnosticsEnabled = true,
            ),
            exportedAt = "2026-05-17T10:00:00Z",
        )
        val raw = defaultJson.encodeToString(LibraryBackupFile.serializer(), backup)

        val decoded = decodeLibraryBackup(raw)

        assertEquals(ANDROID_LIBRARY_SCHEMA_VERSION, decoded.schemaVersion)
        assertEquals("android", decoded.platform)
        assertEquals(listOf("fm4"), decoded.favorites.map { it.id })
        assertEquals("stations", decoded.preferences.listeningHistory)
    }

    @Test
    fun libraryBackupRejectsFutureSchema() {
        val raw = """
            {
              "schemaVersion": 99,
              "exportedAt": "2026-05-17T10:00:00Z",
              "platform": "android"
            }
        """.trimIndent()

        assertThrows(IllegalArgumentException::class.java) {
            decodeLibraryBackup(raw)
        }
    }

    @Test
    fun localDiagnosticEntriesAreSanitizedAndCapped() {
        val entries = (1..205).map {
            diagnosticLogEntry(
                category = "Playback Retry $it",
                message = "failed at https://private.example/$it",
                loggedAt = "2026-05-17T10:00:00Z",
            )
        }

        val capped = cappedDiagnosticLog(entries)

        assertEquals(DIAGNOSTIC_LOG_LIMIT, capped.size)
        assertEquals("playback-retry-1", capped.first().category)
        assertEquals("failed at [url]", capped.first().message)
    }

    @Test
    fun listeningHistoryEntriesAreCapped() {
        val entries = (1..105).map {
            ListeningHistoryEntry(
                playedAt = "2026-05-17T10:00:00Z",
                stationId = "station-$it",
                stationName = "Station $it",
            )
        }

        val capped = cappedListeningHistory(entries)

        assertEquals(LISTENING_HISTORY_LIMIT, capped.size)
        assertEquals("station-1", capped.first().stationId)
    }

    @Test
    fun brokenStationPayloadKeepsOnlyHostAndTruncatedReason() {
        val payload = brokenStationReportPayload(
            station = station("fm4").copy(streamUrl = "https://stream.example.test/live.mp3?token=secret"),
            reason = "x".repeat(200),
            appVersion = "0.1.0",
        )

        assertEquals("stream.example.test", payload.streamHost)
        assertEquals("android", payload.platform)
        assertEquals(160, payload.reason.length)
    }

    private fun station(id: String, name: String = id): Station =
        Station(
            id = id,
            name = name,
            streamUrl = "https://example.com/$id.mp3",
        )

    private fun stationList(id: String): StationList =
        StationList(
            id = id,
            name = id,
            stations = emptyList(),
        )
}
