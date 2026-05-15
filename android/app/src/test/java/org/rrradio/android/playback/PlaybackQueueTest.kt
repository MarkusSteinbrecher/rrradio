package org.rrradio.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rrradio.android.data.Station

class PlaybackQueueTest {
    @Test
    fun activePlaybackQueueUsesVisibleStationsWhenSelectedIsPresent() {
        val first = station("first")
        val second = station("second")
        val queue = activePlaybackQueue(listOf(first, second, first), second)

        assertEquals(listOf(first, second), queue)
        assertEquals(1, playbackQueueStartIndex(queue, second))
    }

    @Test
    fun activePlaybackQueueFallsBackToSingleStationForExternalLaunch() {
        val selected = station("external")

        assertEquals(listOf(selected), activePlaybackQueue(listOf(station("other")), selected))
        assertEquals(0, playbackQueueStartIndex(emptyList(), selected))
    }

    @Test
    fun streamRetryPolicyIsBoundedAndBackedOff() {
        assertTrue(shouldRetryStreamError(0))
        assertTrue(shouldRetryStreamError(1))
        assertFalse(shouldRetryStreamError(2))
        assertEquals(1_500L, streamRetryDelayMillis(1))
        assertEquals(5_000L, streamRetryDelayMillis(9))
    }

    private fun station(id: String): Station =
        Station(
            id = id,
            name = id,
            streamUrl = "https://example.com/$id.mp3",
        )
}
