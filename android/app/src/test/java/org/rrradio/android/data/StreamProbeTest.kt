package org.rrradio.android.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamProbeTest {
    @Test
    fun looksLikePlayableStreamAcceptsAudioAndPlaylists() {
        assertTrue(looksLikePlayableStream("audio/mpeg; charset=utf-8", "https://example.com/live"))
        assertTrue(looksLikePlayableStream("application/vnd.apple.mpegurl", "https://example.com/live"))
        assertTrue(looksLikePlayableStream("application/octet-stream", "https://example.com/live"))
        assertTrue(looksLikePlayableStream(null, "https://example.com/live.m3u8?token=ignored"))
    }

    @Test
    fun looksLikePlayableStreamRejectsHtmlWithoutPlayableExtension() {
        assertFalse(looksLikePlayableStream("text/html", "https://example.com/player"))
    }
}
