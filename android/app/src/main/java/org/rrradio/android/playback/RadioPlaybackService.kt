package org.rrradio.android.playback

import android.content.Intent
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
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.Station
import org.rrradio.android.data.defaultJson
import org.rrradio.android.metadata.MetadataPoller

class RadioPlaybackService : MediaSessionService() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val metadataPoller = MetadataPoller()
    private lateinit var player: ExoPlayer
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this).build()
        player.addListener(playerListener)
        session = MediaSession.Builder(this, player).build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_STATION -> intent.getStringExtra(EXTRA_STATION_JSON)
                ?.let { defaultJson.decodeFromString<Station>(it) }
                ?.let(::play)
            ACTION_TOGGLE -> toggle()
            ACTION_PAUSE -> pause()
            ACTION_STOP -> stopPlayback()
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        metadataPoller.stop()
        serviceScope.cancel()
        session?.release()
        player.release()
        super.onDestroy()
    }

    private fun play(station: Station) {
        metadataPoller.stop()
        PlaybackStateStore.replace(PlaybackUiState(station = station, state = PlayerState.Loading))

        val metadata = MediaMetadata.Builder()
            .setTitle(station.name)
            .setArtist(station.country?.uppercase().orEmpty())
            .build()
        val item = MediaItem.Builder()
            .setUri(station.streamUrl.toUri())
            .setMediaId(station.id)
            .setMediaMetadata(metadata)
            .build()

        player.setMediaItem(item)
        player.prepare()
        player.playWhenReady = true

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

    private fun toggle() {
        if (player.isPlaying) pause() else player.play()
    }

    private fun pause() {
        player.pause()
        PlaybackStateStore.update { it.copy(state = PlayerState.Paused) }
    }

    private fun stopPlayback() {
        metadataPoller.stop()
        player.stop()
        PlaybackStateStore.replace(PlaybackUiState())
        stopSelf()
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            PlaybackStateStore.update {
                it.copy(state = if (isPlaying) PlayerState.Playing else PlayerState.Paused)
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            PlaybackStateStore.update {
                when (playbackState) {
                    Player.STATE_BUFFERING -> it.copy(state = PlayerState.Loading)
                    Player.STATE_READY -> it.copy(state = if (player.isPlaying) PlayerState.Playing else PlayerState.Paused)
                    Player.STATE_ENDED -> it.copy(state = PlayerState.Paused)
                    else -> it
                }
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            PlaybackStateStore.update {
                it.copy(state = PlayerState.Error, errorMessage = error.localizedMessage)
            }
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

    companion object {
        const val ACTION_PLAY_STATION = "org.rrradio.android.action.PLAY_STATION"
        const val ACTION_TOGGLE = "org.rrradio.android.action.TOGGLE"
        const val ACTION_PAUSE = "org.rrradio.android.action.PAUSE"
        const val ACTION_STOP = "org.rrradio.android.action.STOP"
        const val EXTRA_STATION_JSON = "station_json"

        fun playIntent(context: android.content.Context, station: Station): Intent =
            Intent(context, RadioPlaybackService::class.java)
                .setAction(ACTION_PLAY_STATION)
                .putExtra(EXTRA_STATION_JSON, defaultJson.encodeToString(station))

        fun toggleIntent(context: android.content.Context): Intent =
            Intent(context, RadioPlaybackService::class.java).setAction(ACTION_TOGGLE)

        fun pauseIntent(context: android.content.Context): Intent =
            Intent(context, RadioPlaybackService::class.java).setAction(ACTION_PAUSE)
    }
}
