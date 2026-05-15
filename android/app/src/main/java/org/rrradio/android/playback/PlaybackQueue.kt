package org.rrradio.android.playback

import org.rrradio.android.data.Station

fun activePlaybackQueue(visibleStations: List<Station>, selected: Station): List<Station> {
    val uniqueVisible = visibleStations.distinctBy { it.id }
    return if (uniqueVisible.any { it.id == selected.id }) uniqueVisible else listOf(selected)
}

fun playbackQueueStartIndex(queue: List<Station>, selected: Station): Int =
    queue.indexOfFirst { it.id == selected.id }.takeIf { it >= 0 } ?: 0
