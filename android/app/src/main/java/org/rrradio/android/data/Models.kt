package org.rrradio.android.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

@Serializable
data class Station(
    val id: String,
    @Serializable(with = StringCompatibleSerializer::class)
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
data class StationList(
    val id: String,
    val name: String,
    val stations: List<Station> = emptyList(),
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

internal object StringCompatibleSerializer : KSerializer<String> {
    override val descriptor = PrimitiveSerialDescriptor("StringCompatible", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): String {
        val jsonDecoder = decoder as? JsonDecoder ?: return decoder.decodeString()
        val primitive = jsonDecoder.decodeJsonElement() as? JsonPrimitive
            ?: throw SerializationException("Expected string-compatible value")
        if (primitive is JsonNull) throw SerializationException("Expected string-compatible value")
        return primitive.content
    }

    override fun serialize(encoder: Encoder, value: String) {
        encoder.encodeString(value)
    }
}

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
