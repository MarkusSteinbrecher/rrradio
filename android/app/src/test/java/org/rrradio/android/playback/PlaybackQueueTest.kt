package org.rrradio.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
    fun playbackQueueStepIndexWrapsThroughActiveQueue() {
        assertEquals(2, playbackQueueStepIndex(0, 3, PlaybackQueueStepDirection.Backward))
        assertEquals(1, playbackQueueStepIndex(0, 3, PlaybackQueueStepDirection.Forward))
        assertEquals(0, playbackQueueStepIndex(2, 3, PlaybackQueueStepDirection.Forward))
    }

    @Test
    fun playbackQueueStepIndexRequiresARealQueue() {
        assertNull(playbackQueueStepIndex(0, 1, PlaybackQueueStepDirection.Forward))
        assertNull(playbackQueueStepIndex(-1, 3, PlaybackQueueStepDirection.Forward))
        assertNull(playbackQueueStepIndex(3, 3, PlaybackQueueStepDirection.Backward))
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
