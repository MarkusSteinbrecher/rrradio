package org.rrradio.android.metadata

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.rrradio.android.data.NowPlayingMetadata
import org.rrradio.android.data.Station

class MetadataPoller(
    private val icyFetcher: IcyMetadataFetcher = IcyMetadataFetcher(),
    private val intervalMillis: Long = 20_000,
) {
    private var job: Job? = null

    fun start(
        scope: CoroutineScope,
        station: Station,
        onMetadata: (NowPlayingMetadata?) -> Unit,
    ) {
        stop()
        if (!icyFetcher.supports(station)) return

        job = scope.launch {
            while (isActive) {
                val metadata = withContext(Dispatchers.IO) {
                    runCatching { icyFetcher.fetch(station) }.getOrNull()
                }
                onMetadata(metadata)
                delay(intervalMillis)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
