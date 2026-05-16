package org.rrradio.android.data

import org.junit.Assert.assertEquals
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
    fun sleepDefaultMinutesUsesSupportedValuesOnly() {
        assertEquals(30, LibraryRepository.normalizedSleepDefaultMinutes(null))
        assertEquals(30, LibraryRepository.normalizedSleepDefaultMinutes(0))
        assertEquals(15, LibraryRepository.normalizedSleepDefaultMinutes(15))
        assertEquals(90, LibraryRepository.normalizedSleepDefaultMinutes(90))
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
