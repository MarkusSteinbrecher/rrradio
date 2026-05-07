package org.rrradio.android.metadata

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IcyMetadataTest {
    @Test
    fun parseStreamTitleSplitsArtistAndTitle() {
        val parsed = parseStreamTitle("StreamTitle='Artist - Track';StreamUrl='';")

        assertEquals("Artist", parsed?.artist)
        assertEquals("Track", parsed?.title)
        assertEquals("Artist - Track", parsed?.raw)
    }

    @Test
    fun parseStreamTitleFallsBackToTitleOnly() {
        val parsed = parseStreamTitle("StreamTitle='Station ID';")

        assertNull(parsed?.artist)
        assertEquals("Station ID", parsed?.title)
    }
}
