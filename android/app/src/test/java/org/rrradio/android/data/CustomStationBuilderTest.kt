package org.rrradio.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CustomStationBuilderTest {
    @Test
    fun makeCustomStationBuildsHttpsStation() {
        val station = makeCustomStation(
            name = " Test Radio ",
            streamUrl = "https://example.com/live.mp3",
            homepage = "https://example.com",
            country = "ch",
            tags = "jazz, ambient",
            id = "custom-test",
        )

        assertEquals("custom-test", station.id)
        assertEquals("Test Radio", station.name)
        assertEquals("CH", station.country)
        assertEquals(listOf("jazz", "ambient"), station.tags)
        assertEquals(StationStatus.StreamOnly, station.status)
    }

    @Test
    fun makeCustomStationRejectsInsecureStreamUrl() {
        assertThrows(CustomStationValidationError.InsecureStreamUrl::class.java) {
            makeCustomStation(
                name = "Test",
                streamUrl = "http://example.com/live.mp3",
            )
        }
    }
}
