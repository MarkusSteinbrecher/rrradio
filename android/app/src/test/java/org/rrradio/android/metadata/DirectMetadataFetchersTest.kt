package org.rrradio.android.metadata

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DirectMetadataFetchersTest {
    @Test
    fun parseGrrifMetadataUsesLatestTrackAndRelativeCover() {
        val parsed = parseGrrifMetadata(
            """
            [
              {"Title":"older song","Artist":"older artist","URLCover":"/old.jpg"},
              {"Title":"new SONG","Artist":"the BAND","URLCover":"/live/covers/new.jpg"}
            ]
            """.trimIndent(),
        )

        assertEquals("The Band", parsed?.artist)
        assertEquals("New Song", parsed?.title)
        assertEquals("the BAND - new SONG", parsed?.raw)
        assertEquals("https://www.grrif.ch/live/covers/new.jpg", parsed?.coverUrl)
    }

    @Test
    fun parseGrrifMetadataIgnoresDefaultCover() {
        val parsed = parseGrrifMetadata("""[{"Title":"Song","URLCover":"/img/default.jpg"}]""")

        assertEquals("Song", parsed?.title)
        assertNull(parsed?.coverUrl)
    }

    @Test
    fun parseOrfMetadataReturnsCurrentMusicItemAndProgram() {
        val parsed = parseOrfMetadata(
            liveJson = """
            [
              {
                "start": 1000,
                "end": 3000,
                "href": "https://example.com/detail.json",
                "title": "Morning Show",
                "subtitle": "<p>With the host</p>"
              }
            ]
            """.trimIndent(),
            detailJson = """
            {
              "items": [
                {
                  "type": "M",
                  "start": 1200,
                  "duration": 1000,
                  "title": "Track",
                  "interpreter": "Artist",
                  "images": [
                    {
                      "versions": [
                        {"path": "https://img.example/100.jpg", "width": 100},
                        {"path": "https://img.example/600.jpg", "width": 600}
                      ]
                    }
                  ]
                }
              ]
            }
            """.trimIndent(),
            nowMillis = 1500,
        )

        assertEquals("Artist", parsed?.artist)
        assertEquals("Track", parsed?.title)
        assertEquals("Artist - Track", parsed?.raw)
        assertEquals("Morning Show", parsed?.programName)
        assertEquals("With the host", parsed?.programSubtitle)
        assertEquals("https://img.example/600.jpg", parsed?.coverUrl)
    }

    @Test
    fun parseOrfMetadataReturnsProgramWhenNoMusicItemIsCurrent() {
        val parsed = parseOrfMetadata(
            liveJson = """
            [
              {
                "start": 1000,
                "end": 3000,
                "href": "https://example.com/detail.json",
                "title": "News",
                "subtitle": "<strong>Headlines</strong>"
              }
            ]
            """.trimIndent(),
            detailJson = """{"items":[{"type":"B","start":1200,"duration":1000,"title":"Bulletin"}]}""",
            nowMillis = 1500,
        )

        assertNull(parsed?.artist)
        assertNull(parsed?.title)
        assertEquals("", parsed?.raw)
        assertEquals("News", parsed?.programName)
        assertEquals("Headlines", parsed?.programSubtitle)
    }
}
