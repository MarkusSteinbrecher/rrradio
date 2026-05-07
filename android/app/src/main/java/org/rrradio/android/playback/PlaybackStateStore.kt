package org.rrradio.android.playback

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.rrradio.android.data.PlaybackUiState

object PlaybackStateStore {
    private val _state = MutableStateFlow(PlaybackUiState())
    val state: StateFlow<PlaybackUiState> = _state.asStateFlow()

    fun update(reducer: (PlaybackUiState) -> PlaybackUiState) {
        _state.value = reducer(_state.value)
    }

    fun replace(state: PlaybackUiState) {
        _state.value = state
    }
}
