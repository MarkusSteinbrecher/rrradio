package org.rrradio.android.data

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

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

        val parsed = decodeCatalogStations(raw)

        assertEquals(1, parsed.size)
        assertEquals("FM4", parsed.single().name)
        assertEquals(StationStatus.Working, parsed.single().status)
    }

    @Test
    fun stationCatalogAcceptsLegacyArrayRoot() {
        val raw = """
            [
              {
                "id": "fm4",
                "name": "FM4",
                "streamUrl": "https://example.com/fm4.m3u8",
                "country": "AT",
                "status": "working"
              }
            ]
        """.trimIndent()

        val parsed = decodeCatalogStations(raw)

        assertEquals(1, parsed.size)
        assertEquals("FM4", parsed.single().name)
        assertEquals(StationStatus.Working, parsed.single().status)
    }

    @Test
    fun stationCatalogAcceptsNumericStationName() {
        val raw = """
            {
              "stations": [
                {
                  "id": "af-121212121",
                  "name": 121212121,
                  "streamUrl": "https://example.com/powermixfm",
                  "country": "AF",
                  "status": "stream-only"
                }
              ]
            }
        """.trimIndent()

        val parsed = decodeCatalogStations(raw)

        assertEquals("121212121", parsed.single().name)
    }

    @Test
    fun stationCatalogDecodesBundledCatalogArtifact() {
        val catalog = publicCatalogFile()

        val parsed = decodeCatalogStations(catalog.readText())

        assertEquals(true, parsed.isNotEmpty())
    }

    private fun publicCatalogFile(): File {
        var current = File(".").canonicalFile
        while (true) {
            val candidate = File(current, "public/stations.json")
            if (candidate.exists()) return candidate
            current = current.parentFile ?: error("public/stations.json not found")
        }
    }
}
