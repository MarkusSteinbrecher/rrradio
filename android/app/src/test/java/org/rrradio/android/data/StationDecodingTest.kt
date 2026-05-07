package org.rrradio.android.data

import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Test

class StationDecodingTest {
    @Test
    fun stationCatalogIgnoresUnknownKeys() {
        val raw = """
            {
              "stations": [
                {
                  "id": "fm4",
                  "name": "FM4",
                  "streamUrl": "https://example.com/fm4.m3u8",
                  "country": "AT",
                  "tags": ["indie", "news"],
                  "status": "working",
                  "unknown": "ignored"
                }
              ]
            }
        """.trimIndent()

        val parsed = defaultJson.decodeFromString<CatalogResponse>(raw)

        assertEquals(1, parsed.stations.size)
        assertEquals("FM4", parsed.stations.single().name)
        assertEquals(StationStatus.Working, parsed.stations.single().status)
    }
}
