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

    private fun station(id: String, name: String = id): Station =
        Station(
            id = id,
            name = name,
            streamUrl = "https://example.com/$id.mp3",
        )
}
