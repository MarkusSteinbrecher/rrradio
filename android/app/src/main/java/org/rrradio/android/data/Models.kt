package org.rrradio.android.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Station(
    val id: String,
    val name: String,
    val streamUrl: String,
    val homepage: String? = null,
    val country: String? = null,
    val tags: List<String>? = null,
    val favicon: String? = null,
    val bitrate: Int? = null,
    val codec: String? = null,
    val listeners: Int? = null,
    val frequency: String? = null,
    val metadata: String? = null,
    val metadataUrl: String? = null,
    val geo: List<Double>? = null,
    val status: StationStatus? = null,
    val featured: Boolean? = null,
)

@Serializable
enum class StationStatus {
    @SerialName("working")
    Working,

    @SerialName("icy-only")
    IcyOnly,

    @SerialName("stream-only")
    StreamOnly,
}

@Serializable
data class CatalogResponse(
    val stations: List<Station>,
)

enum class CatalogLoadState {
    Idle,
    Loading,
    Loaded,
    Failed,
}

data class CatalogState(
    val stations: List<Station> = emptyList(),
    val loadState: CatalogLoadState = CatalogLoadState.Idle,
    val errorMessage: String? = null,
) {
    val browseOrdered: List<Station>
        get() {
            val featured = stations.filter { it.featured == true }
            val rest = stations.filter { it.featured != true }
            return featured + rest
        }
}

enum class PlayerState {
    Idle,
    Loading,
    Playing,
    Paused,
    Error,
}

data class PlaybackUiState(
    val station: Station? = null,
    val state: PlayerState = PlayerState.Idle,
    val artist: String? = null,
    val title: String? = null,
    val programName: String? = null,
    val programSubtitle: String? = null,
    val coverUrl: String? = null,
    val errorMessage: String? = null,
)

data class NowPlayingMetadata(
    val artist: String? = null,
    val title: String? = null,
    val raw: String,
    val programName: String? = null,
    val programSubtitle: String? = null,
    val coverUrl: String? = null,
)
