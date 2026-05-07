package org.rrradio.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.rrradio.android.data.CatalogLoadState
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.Station
import org.rrradio.android.data.countryDisplayName

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RrradioApp(
    state: RrradioUiState,
    actions: RrradioViewModel,
) {
    var showAddStation by remember { mutableStateOf(false) }
    var showNowPlaying by remember { mutableStateOf(false) }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .navigationBarsPadding(),
            ) {
                if (state.playback.station != null) {
                    MiniPlayer(
                        playback = state.playback,
                        sleepMinutes = state.sleepMinutes,
                        onOpen = { showNowPlaying = true },
                        onToggle = actions::togglePlayback,
                        onSleep = actions::cycleSleepTimer,
                    )
                }
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    NavigationBarItem(
                        selected = state.tab == AppTab.Browse,
                        onClick = { actions.setTab(AppTab.Browse) },
                        icon = { Icon(Icons.Rounded.Public, contentDescription = null) },
                        label = { Text("Browse") },
                    )
                    NavigationBarItem(
                        selected = state.tab == AppTab.Library,
                        onClick = { actions.setTab(AppTab.Library) },
                        icon = { Icon(Icons.Rounded.Favorite, contentDescription = null) },
                        label = { Text("Library") },
                    )
                }
            }
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(padding)
                .statusBarsPadding(),
        ) {
            Header(
                state = state,
                onQuery = actions::setQuery,
                onToggleTheme = actions::toggleTheme,
                onAddStation = { showAddStation = true },
                onCountry = actions::setCountry,
                onTag = actions::setTag,
                onLibrarySource = actions::setLibrarySource,
            )
            StationContent(
                state = state,
                onRefresh = actions::refreshCatalog,
                onPlay = actions::play,
                onFavorite = actions::toggleFavorite,
                onRemoveCustom = actions::removeCustom,
            )
        }
    }

    if (showAddStation) {
        ModalBottomSheet(
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            onDismissRequest = { showAddStation = false },
        ) {
            AddStationSheet(
                onSave = { name, stream, homepage, country, tags, onError ->
                    actions.addCustom(name, stream, homepage, country, tags, onError) {
                        showAddStation = false
                    }
                },
                onCancel = { showAddStation = false },
            )
        }
    }

    if (showNowPlaying && state.playback.station != null) {
        ModalBottomSheet(
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            onDismissRequest = { showNowPlaying = false },
        ) {
            NowPlayingSheet(
                state = state,
                onFavorite = actions::toggleFavorite,
                onToggle = actions::togglePlayback,
                onSleep = actions::cycleSleepTimer,
            )
        }
    }
}

@Composable
private fun Header(
    state: RrradioUiState,
    onQuery: (String) -> Unit,
    onToggleTheme: () -> Unit,
    onAddStation: () -> Unit,
    onCountry: (String?) -> Unit,
    onTag: (String?) -> Unit,
    onLibrarySource: (LibrarySource) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "r r r",
                color = MaterialTheme.colorScheme.primary,
                fontSize = 17.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = " a d i o . o r g",
                color = MaterialTheme.colorScheme.onSurface,
                fontSize = 17.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onToggleTheme) {
                Icon(
                    if (state.darkTheme) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
                    contentDescription = "Switch theme",
                )
            }
            IconButton(onClick = onAddStation) {
                Icon(Icons.Rounded.Add, contentDescription = "Add custom station")
            }
        }

        OutlinedTextField(
            value = state.query,
            onValueChange = onQuery,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
            trailingIcon = {
                if (state.query.isNotEmpty()) {
                    IconButton(onClick = { onQuery("") }) {
                        Icon(Icons.Rounded.Close, contentDescription = "Clear search")
                    }
                }
            },
            placeholder = { Text("Search stations") },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
            shape = RoundedCornerShape(24.dp),
        )

        if (state.tab == AppTab.Browse) {
            BrowseFilters(state, onCountry, onTag)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = state.librarySource == LibrarySource.Favorites,
                    onClick = { onLibrarySource(LibrarySource.Favorites) },
                    label = { Text("Favorites") },
                )
                FilterChip(
                    selected = state.librarySource == LibrarySource.Recents,
                    onClick = { onLibrarySource(LibrarySource.Recents) },
                    label = { Text("Recents") },
                )
            }
        }
    }
}

@Composable
private fun BrowseFilters(
    state: RrradioUiState,
    onCountry: (String?) -> Unit,
    onTag: (String?) -> Unit,
) {
    var countryOpen by remember { mutableStateOf(false) }
    var genreOpen by remember { mutableStateOf(false) }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box {
            AssistChip(
                onClick = { genreOpen = true },
                label = { Text(state.selectedTag ?: "Genre") },
            )
            DropdownMenu(expanded = genreOpen, onDismissRequest = { genreOpen = false }) {
                DropdownMenuItem(
                    text = { Text("All genres") },
                    onClick = {
                        onTag(null)
                        genreOpen = false
                    },
                )
                state.genres.forEach { tag ->
                    DropdownMenuItem(
                        text = { Text(tag) },
                        onClick = {
                            onTag(tag)
                            genreOpen = false
                        },
                    )
                }
            }
        }
        Box {
            AssistChip(
                onClick = { countryOpen = true },
                label = { Text(state.selectedCountry ?: "Country") },
            )
            DropdownMenu(expanded = countryOpen, onDismissRequest = { countryOpen = false }) {
                DropdownMenuItem(
                    text = { Text("All countries") },
                    onClick = {
                        onCountry(null)
                        countryOpen = false
                    },
                )
                state.countries.take(90).forEach { code ->
                    DropdownMenuItem(
                        text = { Text("${countryDisplayName(code)} ($code)") },
                        onClick = {
                            onCountry(code)
                            countryOpen = false
                        },
                    )
                }
            }
        }
        FilterChip(
            selected = state.selectedTag == "news",
            onClick = { onTag(if (state.selectedTag == "news") null else "news") },
            label = { Text("News") },
        )
    }
}

@Composable
private fun StationContent(
    state: RrradioUiState,
    onRefresh: () -> Unit,
    onPlay: (Station) -> Unit,
    onFavorite: (Station) -> Unit,
    onRemoveCustom: (Station) -> Unit,
) {
    when {
        state.isCatalogEmptyLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }

        state.catalog.loadState == CatalogLoadState.Failed && state.tab == AppTab.Browse -> {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Catalog unavailable", fontWeight = FontWeight.SemiBold)
                Text(
                    state.catalog.errorMessage.orEmpty(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
                TextButton(onClick = onRefresh) { Text("Retry") }
            }
        }

        state.visibleStations.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No stations", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        else -> LazyColumn(Modifier.fillMaxSize()) {
            items(state.visibleStations, key = { it.id }) { station ->
                StationRow(
                    station = station,
                    isPlaying = state.playback.station?.id == station.id,
                    isFavorite = state.favorites.any { it.id == station.id },
                    isCustom = state.customStations.any { it.id == station.id },
                    onPlay = { onPlay(station) },
                    onFavorite = { onFavorite(station) },
                    onRemoveCustom = { onRemoveCustom(station) },
                )
                Divider(color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}

@Composable
private fun StationRow(
    station: Station,
    isPlaying: Boolean,
    isFavorite: Boolean,
    isCustom: Boolean,
    onPlay: () -> Unit,
    onFavorite: () -> Unit,
    onRemoveCustom: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onPlay)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StationAvatar(station)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                station.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontWeight = if (isPlaying) FontWeight.SemiBold else FontWeight.Medium,
            )
            Text(
                stationMeta(station),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                fontFamily = FontFamily.Monospace,
            )
        }
        IconButton(onClick = onFavorite) {
            Icon(
                if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = if (isFavorite) "Remove favorite" else "Add favorite",
                tint = if (isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (isCustom) {
            IconButton(onClick = onRemoveCustom) {
                Icon(Icons.Rounded.Close, contentDescription = "Remove custom station")
            }
        }
    }
}

@Composable
private fun MiniPlayer(
    playback: org.rrradio.android.data.PlaybackUiState,
    sleepMinutes: Int,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    onSleep: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(onClick = onOpen)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StationAvatar(playback.station)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(playback.station?.name.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                playbackLine(playback),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
            )
        }
        TextButton(onClick = onSleep) {
            Text(if (sleepMinutes > 0) "${sleepMinutes}m" else "Sleep")
        }
        IconButton(onClick = onToggle) {
            Icon(
                if (playback.state == PlayerState.Playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                contentDescription = if (playback.state == PlayerState.Playing) "Pause" else "Play",
            )
        }
    }
}

@Composable
private fun NowPlayingSheet(
    state: RrradioUiState,
    onFavorite: (Station) -> Unit,
    onToggle: () -> Unit,
    onSleep: () -> Unit,
) {
    val station = state.playback.station ?: return
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        StationAvatar(station, size = 92)
        Text(station.name, fontSize = 28.sp, fontWeight = FontWeight.Medium, maxLines = 2)
        Text(
            stationMeta(station),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontFamily = FontFamily.Monospace,
            fontSize = 12.sp,
        )
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(state.playback.title ?: "Live radio", fontWeight = FontWeight.SemiBold)
                Text(
                    state.playback.artist ?: state.playback.programName ?: station.country?.uppercase().orEmpty(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (state.playback.errorMessage != null) {
                    Text(state.playback.errorMessage, color = MaterialTheme.colorScheme.error)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onFavorite(station) }) {
                val favorite = state.favorites.any { it.id == station.id }
                Icon(
                    if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = if (favorite) "Remove favorite" else "Add favorite",
                )
            }
            Button(onClick = onToggle) {
                Icon(
                    if (state.playback.state == PlayerState.Playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = null,
                )
                Spacer(Modifier.width(8.dp))
                Text(if (state.playback.state == PlayerState.Playing) "Pause" else "Play")
            }
            TextButton(onClick = onSleep) {
                Text(if (state.sleepMinutes > 0) "Sleep ${state.sleepMinutes}m" else "Sleep")
            }
        }
    }
}

@Composable
private fun AddStationSheet(
    onSave: (
        name: String,
        streamUrl: String,
        homepage: String,
        country: String,
        tags: String,
        onError: (String) -> Unit,
    ) -> Unit,
    onCancel: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var stream by remember { mutableStateOf("") }
    var homepage by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("") }
    var tags by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add station", fontSize = 22.sp, fontWeight = FontWeight.Medium)
        OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
        OutlinedTextField(stream, { stream = it }, Modifier.fillMaxWidth(), label = { Text("Stream URL") }, singleLine = true)
        OutlinedTextField(homepage, { homepage = it }, Modifier.fillMaxWidth(), label = { Text("Homepage") }, singleLine = true)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(country, { country = it }, Modifier.weight(0.35f), label = { Text("Country") }, singleLine = true)
            OutlinedTextField(tags, { tags = it }, Modifier.weight(0.65f), label = { Text("Tags") }, singleLine = true)
        }
        if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Button(
                onClick = {
                    onSave(name, stream, homepage, country, tags) { error = it }
                },
            ) {
                Text("Save")
            }
        }
    }
}

@Composable
private fun StationAvatar(station: Station?, size: Int = 42) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Rounded.MusicNote,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size((size * 0.54f).dp),
        )
    }
}

private fun stationMeta(station: Station): String {
    val parts = buildList {
        station.country?.uppercase()?.let(::add)
        station.codec?.takeIf { it.isNotBlank() }?.let(::add)
        station.bitrate?.let { add("${it}k") }
        station.tags.orEmpty().take(3).forEach(::add)
    }
    return parts.joinToString(" . ").ifEmpty { "stream" }
}

private fun playbackLine(playback: org.rrradio.android.data.PlaybackUiState): String {
    if (playback.title != null && playback.artist != null) return "${playback.artist} - ${playback.title}"
    if (playback.title != null) return playback.title
    return when (playback.state) {
        PlayerState.Idle -> "Standby"
        PlayerState.Loading -> "Loading"
        PlayerState.Playing -> "Live"
        PlayerState.Paused -> "Paused"
        PlayerState.Error -> "Error"
    }
}
