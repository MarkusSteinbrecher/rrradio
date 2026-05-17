package org.rrradio.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamUrlResolverTest {
    @Test
    fun shouldResolvePlaylistUrlOnlyResolvesPlainPlaylists() {
        assertTrue(shouldResolvePlaylistUrl("https://example.com/live.m3u"))
        assertTrue(shouldResolvePlaylistUrl("https://example.com/live.pls?station=one"))

        assertFalse(shouldResolvePlaylistUrl("https://example.com/live.m3u8"))
        assertFalse(shouldResolvePlaylistUrl("https://example.com/live.mp3"))
    }

    @Test
    fun parseM3uPlaylistUsesFirstPlayableEntry() {
        val text = """
            #EXTM3U
            #EXTINF:-1,Example Radio
            streams/live.mp3
        """.trimIndent()

        assertEquals(
            "https://example.com/radio/streams/live.mp3",
            parseM3uPlaylist(text, "https://example.com/radio/listen.m3u"),
        )
    }

    @Test
    fun parsePlsPlaylistUsesFirstFileEntry() {
        val text = """
            [playlist]
            NumberOfEntries=1
            File1=https://stream.example.com/live.aac
            Title1=Example Radio
        """.trimIndent()

        assertEquals(
            "https://stream.example.com/live.aac",
            parsePlsPlaylist(text, "https://example.com/listen.pls"),
        )
    }

    @Test
    fun parsePlsPlaylistResolvesRelativeFileEntry() {
        val text = """
            [playlist]
            file1=../live
        """.trimIndent()

        assertEquals(
            "https://example.com/live",
            parsePlsPlaylist(text, "https://example.com/radio/listen.pls"),
        )
    }

    @Test
    fun parsePlaylistReturnsNullWhenNoPlayableEntryExists() {
        assertNull(parsePlaylistStreamUrl("#EXTM3U\n#EXTINF:-1,Empty", "https://example.com/listen.m3u"))
        assertNull(parsePlaylistStreamUrl("[playlist]\nTitle1=Empty", "https://example.com/listen.pls"))
    }
}
