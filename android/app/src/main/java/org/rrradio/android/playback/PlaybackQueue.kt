package org.rrradio.android.playback

import org.rrradio.android.data.Station

enum class PlaybackQueueStepDirection {
    Backward,
    Forward,
}

fun activePlaybackQueue(visibleStations: List<Station>, selected: Station): List<Station> {
    val uniqueVisible = visibleStations.distinctBy { it.id }
    return if (uniqueVisible.any { it.id == selected.id }) uniqueVisible else listOf(selected)
}

fun playbackQueueStartIndex(queue: List<Station>, selected: Station): Int =
    queue.indexOfFirst { it.id == selected.id }.takeIf { it >= 0 } ?: 0

fun playbackQueueStepIndex(
    currentIndex: Int,
    queueSize: Int,
    direction: PlaybackQueueStepDirection,
): Int? {
    if (queueSize <= 1 || currentIndex !in 0 until queueSize) return null
    return when (direction) {
        PlaybackQueueStepDirection.Backward -> (currentIndex - 1 + queueSize) % queueSize
        PlaybackQueueStepDirection.Forward -> (currentIndex + 1) % queueSize
    }
}
