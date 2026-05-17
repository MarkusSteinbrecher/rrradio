package org.rrradio.android.metadata

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ITunesCoverArtTest {
    @Test
    fun iTunesSearchUrlUsesTrimmedBoundedMusicQuery() {
        val url = iTunesSearchUrl(" Artist ", " Track ")!!

        assertEquals("Artist Track", url.queryParameter("term"))
        assertEquals("song", url.queryParameter("entity"))
        assertEquals("5", url.queryParameter("limit"))
        assertEquals("music", url.queryParameter("media"))
    }

    @Test
    fun iTunesSearchUrlRejectsPlaceholderTitles() {
        assertNull(iTunesSearchUrl(null, "-"))
        assertNull(iTunesSearchUrl(null, "\u2014"))
        assertNull(iTunesSearchUrl(null, "ab"))
    }

    @Test
    fun iTunesCoverArtResultPicksExactMatchAndHighResolutionCover() {
        val result = iTunesCoverArtResult(
            payload = ITunesSearchResponse(
                resultCount = 2,
                results = listOf(
                    ITunesTrack(
                        artistName = "Other",
                        trackName = "Track",
                        artworkUrl100 = "https://is1-ssl.mzstatic.com/image/thumb/Music/aa/100x100bb.jpg",
                    ),
                    ITunesTrack(
                        artistName = "Artist",
                        trackName = "Track",
                        artworkUrl100 = "https://is1-ssl.mzstatic.com/image/thumb/Music/bb/100x100bb.jpg",
                        trackViewUrl = "https://music.apple.com/us/album/track/1?i=2",
                    ),
                ),
            ),
            artist = "Artist",
            title = "Track",
        )

        assertTrue(result.hit)
        assertEquals("https://is1-ssl.mzstatic.com/image/thumb/Music/bb/600x600bb.jpg", result.coverUrl)
        assertEquals("https://music.apple.com/us/album/track/1?i=2", result.appleMusicUrl)
    }

    @Test
    fun iTunesCoverArtResultReportsMissWithoutCover() {
        val result = iTunesCoverArtResult(ITunesSearchResponse(resultCount = 0), artist = null, title = "News")

        assertFalse(result.hit)
        assertNull(result.coverUrl)
        assertNull(result.appleMusicUrl)
    }

    @Test
    fun lowResolutionCoverDetectionMatchesKnownStationPatterns() {
        assertTrue(isLowResolutionCoverUrl("https://example.com/Medias/Covers/m/foo.jpg"))
        assertTrue(isLowResolutionCoverUrl("https://example.com/50/foo.jpg"))
        assertFalse(isLowResolutionCoverUrl("https://example.com/600/foo.jpg"))
    }
}
