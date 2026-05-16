package org.rrradio.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchTest {
    @Test
    fun normalizeForSearchKeepsGermanDiacriticsAndDropsSpacing() {
        assertTrue(normalizeForSearch("NDR 90,3") == "ndr903")
        assertTrue(normalizeForSearch("Ö1 Campus") == "ö1campus")
    }

    @Test
    fun stationMatchesAcrossNameTagsAndCountry() {
        val station = Station(
            id = "wdr5",
            name = "WDR 5",
            streamUrl = "https://example.com/live.mp3",
            country = "DE",
            tags = listOf("news", "talk"),
        )

        assertTrue(stationMatches(station, "wdr5"))
        assertTrue(stationMatches(station, "news"))
        assertTrue(stationMatches(station, "de"))
        assertFalse(stationMatches(station, "jazz"))
    }

    @Test
    fun stationMatchesFoldedDiacriticInput() {
        val station = Station(
            id = "oe1-campus",
            name = "Ö1 Campus",
            streamUrl = "https://example.com/live.mp3",
            country = "AT",
            tags = listOf("classical"),
        )

        assertTrue(stationMatches(station, "O1"))
        assertTrue(stationMatches(station, "Austria"))
    }

    @Test
    fun streamQualityLevelUsesCodecAwareThresholds() {
        assertEquals(4, streamQualityLevel(codec = "AAC", bitrate = 128))
        assertEquals(3, streamQualityLevel(codec = "MP3", bitrate = 128))
        assertEquals(4, streamQualityLevel(codec = "FLAC", bitrate = null))
        assertEquals(1, streamQualityLevel(codec = null, bitrate = null))
    }

    @Test
    fun sortedBrowseStationsOrdersByQualityAndFavorites() {
        val low = station("low", "B Low", codec = "MP3", bitrate = 64)
        val high = station("high", "A High", codec = "AAC", bitrate = 128)
        val mid = station("mid", "C Mid", codec = "MP3", bitrate = 128)
        val stations = listOf(low, high, mid)

        assertEquals(
            listOf(high, mid, low),
            sortedBrowseStations(stations, BrowseStationSort.QualityHigh, emptySet()),
        )
        assertEquals(
            listOf(low, mid, high),
            sortedBrowseStations(stations, BrowseStationSort.QualityLow, emptySet()),
        )
        assertEquals(
            listOf(mid, high, low),
            sortedBrowseStations(stations, BrowseStationSort.FavoritesFirst, setOf("mid")),
        )
    }

    @Test
    fun sortedBrowseStationsOrdersByName() {
        val stations = listOf(
            station("charlie", "Charlie"),
            station("alpha", "alpha"),
            station("bravo", "\tBravo"),
        )

        assertEquals(
            listOf("alpha", "bravo", "charlie"),
            sortedBrowseStations(stations, BrowseStationSort.AlphabetAscending, emptySet()).map { it.id },
        )
        assertEquals(
            listOf("charlie", "bravo", "alpha"),
            sortedBrowseStations(stations, BrowseStationSort.AlphabetDescending, emptySet()).map { it.id },
        )
    }

    private fun station(
        id: String,
        name: String,
        codec: String? = null,
        bitrate: Int? = null,
    ): Station = Station(
        id = id,
        name = name,
        streamUrl = "https://example.com/$id.mp3",
        codec = codec,
        bitrate = bitrate,
    )
}
