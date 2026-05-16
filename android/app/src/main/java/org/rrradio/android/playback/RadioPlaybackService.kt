package org.rrradio.android.playback

import android.content.Intent
import androidx.media3.common.C
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.Station
import org.rrradio.android.data.defaultJson
import org.rrradio.android.data.displayName
import org.rrradio.android.metadata.MetadataPoller

class RadioPlaybackService : MediaSessionService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val metadataPoller = MetadataPoller()
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null
    private var activeQueue: List<Station> = emptyList()
    private var retryJob: Job? = null
    private var retryCount = 0

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this).build()
        player.addListener(playerListener)
        session = MediaSession.Builder(this, player).build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_STATION -> {
                val station = intent.getStringExtra(EXTRA_STATION_JSON)
                    ?.let { defaultJson.decodeFromString<Station>(it) }
                val queue = intent.getStringExtra(EXTRA_QUEUE_JSON)
                    ?.let { runCatching { defaultJson.decodeFromString<List<Station>>(it) }.getOrNull() }
                    .orEmpty()
                if (station != null) play(station, queue)
            }
            ACTION_TOGGLE -> toggle()
            ACTION_PAUSE -> pause()
            ACTION_PREVIOUS -> step(PlaybackQueueStepDirection.Backward)
            ACTION_NEXT -> step(PlaybackQueueStepDirection.Forward)
            ACTION_STOP -> stopPlayback()
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        retryJob?.cancel()
        metadataPoller.stop()
        serviceScope.cancel()
        session?.release()
        player.release()
        super.onDestroy()
    }

    private fun play(station: Station, queue: List<Station>) {
        retryJob?.cancel()
        retryCount = 0
        activeQueue = activePlaybackQueue(queue, station)
        val startIndex = playbackQueueStartIndex(activeQueue, station)
        setCurrentStation(station, PlayerState.Loading)

        player.setMediaItems(activeQueue.map(::mediaItem), startIndex, C.TIME_UNSET)
        player.prepare()
        player.playWhenReady = true
        startMetadataPolling(station)
    }

    private fun mediaItem(station: Station): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(station.displayName())
            .setArtist(station.country?.uppercase().orEmpty())
            .build()
        return MediaItem.Builder()
            .setUri(station.streamUrl.toUri())
            .setMediaId(station.id)
            .setMediaMetadata(metadata)
            .build()
    }

    private fun startMetadataPolling(station: Station) {
        metadataPoller.stop()
        metadataPoller.start(serviceScope, station) { now ->
            if (now == null) return@start
            PlaybackStateStore.update { current ->
                if (current.station?.id != station.id) current
                else current.copy(
                    artist = now.artist,
                    title = now.title,
                    programName = now.programName,
                    programSubtitle = now.programSubtitle,
                    coverUrl = now.coverUrl,
                )
            }
        }
    }

    private fun setCurrentStation(station: Station, state: PlayerState) {
        val queueIndex = activeQueue.indexOfFirst { it.id == station.id }.takeIf { it >= 0 } ?: 0
        PlaybackStateStore.replace(
            PlaybackUiState(
                station = station,
                state = state,
                queueIndex = queueIndex,
                queueSize = activeQueue.size,
            ),
        )
    }

    private fun toggle() {
        if (player.isPlaying) pause() else player.play()
    }

    private fun pause() {
        player.pause()
        PlaybackStateStore.update { it.copy(state = PlayerState.Paused) }
    }

    private fun step(direction: PlaybackQueueStepDirection) {
        val targetIndex = playbackQueueStepIndex(
            currentIndex = player.currentMediaItemIndex,
            queueSize = activeQueue.size,
            direction = direction,
        ) ?: return
        val station = activeQueue[targetIndex]

        retryJob?.cancel()
        retryCount = 0
        setCurrentStation(station, PlayerState.Loading)
        player.seekTo(targetIndex, C.TIME_UNSET)
        player.prepare()
        player.playWhenReady = true
        startMetadataPolling(station)
    }

    private fun stopPlayback() {
        retryJob?.cancel()
        retryCount = 0
        activeQueue = emptyList()
        metadataPoller.stop()
        player.stop()
        PlaybackStateStore.replace(PlaybackUiState())
        stopSelf()
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!isPlaying && player.playbackState == Player.STATE_BUFFERING) return
            PlaybackStateStore.update {
                it.copy(state = if (isPlaying) PlayerState.Playing else PlayerState.Paused)
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            PlaybackStateStore.update {
                when (playbackState) {
                    Player.STATE_BUFFERING -> it.copy(state = PlayerState.Loading)
                    Player.STATE_READY -> {
                        retryCount = 0
                        it.copy(state = if (player.isPlaying) PlayerState.Playing else PlayerState.Paused)
                    }
                    Player.STATE_ENDED -> it.copy(state = PlayerState.Paused)
                    else -> it
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            if (scheduleRetry()) return
            PlaybackStateStore.update {
                it.copy(state = PlayerState.Error, errorMessage = "Stream unavailable. Try again.")
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val station = activeQueue.firstOrNull { it.id == mediaItem?.mediaId } ?: return
            setCurrentStation(
                station = station,
                state = if (player.isPlaying) PlayerState.Playing else PlayerState.Loading,
            )
            startMetadataPolling(station)
        }

        override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
            val title = mediaMetadata.title?.toString()?.takeIf { it.isNotBlank() }
            val artist = mediaMetadata.artist?.toString()?.takeIf { it.isNotBlank() }
            if (title == null && artist == null) return
            PlaybackStateStore.update { current ->
                current.copy(
                    title = title ?: current.title,
                    artist = artist ?: current.artist,
                )
            }
        }
    }

    private fun scheduleRetry(): Boolean {
        val station = PlaybackStateStore.state.value.station ?: return false
        if (!shouldRetryStreamError(retryCount)) return false

        retryCount += 1
        retryJob?.cancel()
        PlaybackStateStore.update {
            it.copy(state = PlayerState.Loading, errorMessage = "Reconnecting...")
        }
        retryJob = serviceScope.launch {
            delay(streamRetryDelayMillis(retryCount))
            val queue = activeQueue.takeIf { it.isNotEmpty() } ?: listOf(station)
            activeQueue = activePlaybackQueue(queue, station)
            val startIndex = playbackQueueStartIndex(activeQueue, station)
            player.setMediaItems(activeQueue.map(::mediaItem), startIndex, C.TIME_UNSET)
            player.prepare()
            player.playWhenReady = true
            startMetadataPolling(station)
        }
        return true
    }

    companion object {
        const val ACTION_PLAY_STATION = "org.rrradio.android.action.PLAY_STATION"
        const val ACTION_TOGGLE = "org.rrradio.android.action.TOGGLE"
        const val ACTION_PAUSE = "org.rrradio.android.action.PAUSE"
        const val ACTION_PREVIOUS = "org.rrradio.android.action.PREVIOUS"
        const val ACTION_NEXT = "org.rrradio.android.action.NEXT"
        const val ACTION_STOP = "org.rrradio.android.action.STOP"
        const val EXTRA_STATION_JSON = "station_json"
        const val EXTRA_QUEUE_JSON = "queue_json"

        fun playIntent(context: android.content.Context, station: Station, queue: List<Station> = listOf(station)): Intent =
            Intent(context, RadioPlaybackService::class.java)
                .setAction(ACTION_PLAY_STATION)
                .putExtra(EXTRA_STATION_JSON, defaultJson.encodeToString(station))
                .putExtra(EXTRA_QUEUE_JSON, defaultJson.encodeToString(activePlaybackQueue(queue, station)))

        fun toggleIntent(context: android.content.Context): Intent =
            Intent(context, RadioPlaybackService::class.java).setAction(ACTION_TOGGLE)

        fun pauseIntent(context: android.content.Context): Intent =
            Intent(context, RadioPlaybackService::class.java).setAction(ACTION_PAUSE)

        fun previousIntent(context: android.content.Context): Intent =
            Intent(context, RadioPlaybackService::class.java).setAction(ACTION_PREVIOUS)

        fun nextIntent(context: android.content.Context): Intent =
            Intent(context, RadioPlaybackService::class.java).setAction(ACTION_NEXT)
    }
}
