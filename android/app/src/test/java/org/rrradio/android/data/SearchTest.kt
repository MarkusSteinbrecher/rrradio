package org.rrradio.android.data

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
}
