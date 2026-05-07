package org.rrradio.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Article
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import org.rrradio.android.data.CatalogLoadState
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.Station
import org.rrradio.android.data.StationStatus
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
                    .background(MaterialTheme.colorScheme.background)
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
                BottomTabBar(
                    tab = state.tab,
                    onTab = actions::setTab,
                )
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
                onPlay = {
                    actions.play(it)
                    showNowPlaying = true
                },
                onFavorite = actions::toggleFavorite,
                onRemoveCustom = actions::removeCustom,
            )
        }
    }

    if (showAddStation) {
        ModalBottomSheet(
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background,
            dragHandle = null,
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
            containerColor = MaterialTheme.colorScheme.background,
            dragHandle = null,
            onDismissRequest = { showNowPlaying = false },
        ) {
            NowPlayingSheet(
                state = state,
                onFavorite = actions::toggleFavorite,
                onToggle = actions::togglePlayback,
                onSleep = actions::cycleSleepTimer,
                onDismiss = { showNowPlaying = false },
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
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp)
            .padding(top = 14.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(4.dp))
                    .clickable {
                        onQuery("")
                        onCountry(null)
                        onTag(null)
                    },
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    text = "r r r",
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = " a d i o . o r g",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = "  beta",
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(bottom = 2.dp),
                )
            }

            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CircleIconButton(
                    icon = if (state.darkTheme) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
                    label = "Switch theme",
                    onClick = onToggleTheme,
                )
                CircleIconButton(
                    icon = Icons.Rounded.Add,
                    label = "Add custom station",
                    onClick = onAddStation,
                )
            }
        }

        SearchField(
            query = state.query,
            placeholder = searchPlaceholder(state),
            onQuery = onQuery,
        )

        if (state.tab == AppTab.Browse) {
            BrowseFilters(state, onCountry, onTag, onLibrarySource)
        } else {
            LibrarySegments(state.librarySource, onLibrarySource)
        }

        SectionStatus(state)
    }
}

@Composable
private fun SearchField(
    query: String,
    placeholder: String,
    onQuery: (String) -> Unit,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 42.dp),
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 16.sp),
        leadingIcon = {
            Icon(
                Icons.Rounded.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQuery("") }, modifier = Modifier.size(30.dp)) {
                    Icon(
                        Icons.Rounded.Close,
                        contentDescription = "Clear search",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        },
        placeholder = {
            Text(
                placeholder,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.62f),
            )
        },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
        shape = CircleShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.outline,
            unfocusedBorderColor = MaterialTheme.colorScheme.outline,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    )
}

@Composable
private fun BrowseFilters(
    state: RrradioUiState,
    onCountry: (String?) -> Unit,
    onTag: (String?) -> Unit,
    onLibrarySource: (LibrarySource) -> Unit,
) {
    var countryOpen by remember { mutableStateOf(false) }
    var genreOpen by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()

    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(scroll),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        FilterCell("Curated") {
            RoundFilterButton(
                icon = Icons.Rounded.Star,
                active = state.selectedCountry == null && state.selectedTag == null,
                onClick = {
                    onCountry(null)
                    onTag(null)
                },
            )
        }
        FilterCell("Played") {
            RoundFilterButton(
                icon = Icons.Rounded.BarChart,
                active = state.tab == AppTab.Library && state.librarySource == LibrarySource.Recents,
                onClick = { onLibrarySource(LibrarySource.Recents) },
            )
        }
        FilterCell("News") {
            RoundFilterButton(
                icon = Icons.AutoMirrored.Rounded.Article,
                active = state.selectedTag == "news",
                onClick = { onTag(if (state.selectedTag == "news") null else "news") },
            )
        }
        FilterCell("Genre") {
            Box {
                RoundFilterButton(
                    icon = Icons.Rounded.MusicNote,
                    active = state.selectedTag != null && state.selectedTag != "news",
                    onClick = { genreOpen = true },
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
        }
        FilterCell("Country") {
            Box {
                RoundFilterButton(
                    icon = Icons.Rounded.Flag,
                    active = state.selectedCountry != null,
                    onClick = { countryOpen = true },
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
        }
    }
}

@Composable
private fun LibrarySegments(
    source: LibrarySource,
    onLibrarySource: (LibrarySource) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        SegmentButton(
            label = "Favorites",
            selected = source == LibrarySource.Favorites,
            onClick = { onLibrarySource(LibrarySource.Favorites) },
            modifier = Modifier.weight(1f),
        )
        SegmentButton(
            label = "Recents",
            selected = source == LibrarySource.Recents,
            onClick = { onLibrarySource(LibrarySource.Recents) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SegmentButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .height(32.dp)
            .clip(CircleShape)
            .background(if (selected) MaterialTheme.colorScheme.onBackground else Color.Transparent)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label.uppercase(),
            color = if (selected) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            letterSpacing = 1.2.sp,
        )
    }
}

@Composable
private fun SectionStatus(state: RrradioUiState) {
    val label = when {
        state.tab == AppTab.Library && state.librarySource == LibrarySource.Favorites -> "Favorites"
        state.tab == AppTab.Library && state.librarySource == LibrarySource.Recents -> "Recents"
        state.query.trim().isNotEmpty() || state.selectedCountry != null || state.selectedTag != null -> "Filtered"
        else -> "Curated + worldwide"
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label.uppercase(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            letterSpacing = 1.5.sp,
        )
        Text(
            " . ",
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            "${state.visibleStations.size}",
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
            fontSize = 10.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
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
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
        }

        state.catalog.loadState == CatalogLoadState.Failed && state.tab == AppTab.Browse -> {
            EmptyState(
                title = "Catalog unavailable",
                description = state.catalog.errorMessage.orEmpty(),
                actionLabel = "Retry",
                onAction = onRefresh,
            )
        }

        state.visibleStations.isEmpty() -> {
            EmptyState(
                title = "No stations found",
                description = "Try a station name, country code, or tag.",
            )
        }

        else -> LazyColumn(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        ) {
            items(state.visibleStations, key = { it.id }) { station ->
                StationRow(
                    station = station,
                    isPlaying = state.playback.station?.id == station.id && state.playback.state == PlayerState.Playing,
                    isCurrent = state.playback.station?.id == station.id,
                    isFavorite = state.favorites.any { it.id == station.id },
                    isCustom = state.customStations.any { it.id == station.id },
                    onPlay = { onPlay(station) },
                    onFavorite = { onFavorite(station) },
                    onRemoveCustom = { onRemoveCustom(station) },
                )
                DividerLine()
            }
        }
    }
}

@Composable
private fun StationRow(
    station: Station,
    isPlaying: Boolean,
    isCurrent: Boolean,
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
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        StationAvatar(station, size = 46, imageUrl = station.favicon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    station.name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f, fill = false),
                )
                station.country?.let {
                    Text(
                        it.uppercase(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 10.5.sp,
                        fontWeight = FontWeight.Medium,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    capabilityStars(station),
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 10.5.sp,
                    fontFamily = FontFamily.Monospace,
                )
                Text(
                    station.tags.orEmpty().take(3).joinToString(" . ").ifEmpty { station.codec ?: "stream" },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.5.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
        }
        if (isPlaying) LiveBars()
        IconButton(onClick = onFavorite, modifier = Modifier.size(36.dp)) {
            Icon(
                if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                contentDescription = if (isFavorite) "Remove favorite" else "Add favorite",
                tint = if (isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(19.dp),
            )
        }
        if (isCustom) {
            IconButton(onClick = onRemoveCustom, modifier = Modifier.size(30.dp)) {
                Icon(
                    Icons.Rounded.Close,
                    contentDescription = "Remove custom station",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun MiniPlayer(
    playback: PlaybackUiState,
    sleepMinutes: Int,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    onSleep: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        DividerLine()
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 66.dp)
                .clickable(onClick = onOpen)
                .padding(start = 20.dp, end = 14.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            StationAvatar(
                playback.station,
                size = 46,
                imageUrl = playback.coverUrl ?: playback.station?.favicon,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    playback.station?.name.orEmpty(),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
                MiniSubtitle(playback)
            }
            TextButton(onClick = onSleep) {
                Text(
                    if (sleepMinutes > 0) "${sleepMinutes}m" else "Sleep",
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }
            CircleIconButton(
                icon = if (playback.state == PlayerState.Playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                label = if (playback.state == PlayerState.Playing) "Pause" else "Play",
                size = 36,
                iconSize = 18,
                onClick = onToggle,
            )
        }
    }
}

@Composable
private fun MiniSubtitle(playback: PlaybackUiState) {
    val line = trackLine(playback)
    if (line != null) {
        Text(
            line,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
            fontSize = 11.5.sp,
        )
    } else {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (playback.state == PlayerState.Playing) {
                Box(
                    Modifier
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
                )
            }
            Text(
                stateLine(playback).uppercase(),
                maxLines = 1,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = FontFamily.Monospace,
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
    onDismiss: () -> Unit,
) {
    val station = state.playback.station ?: return
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(bottom = 24.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onDismiss) {
                Icon(Icons.Rounded.Close, contentDescription = "Dismiss now playing")
            }
            Spacer(Modifier.weight(1f))
            Text(
                "NOW PLAYING",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = FontFamily.Monospace,
                letterSpacing = 2.sp,
            )
            Spacer(Modifier.weight(1f))
            Spacer(Modifier.width(48.dp))
        }

        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StationAvatar(station, size = 46, imageUrl = station.favicon)
                Text(
                    station.name,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                tagLine(station),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
        }
        DividerLine()

        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Artwork(
                station = station,
                imageUrl = state.playback.coverUrl ?: station.favicon,
            )
            Text(
                state.playback.title ?: "Live radio",
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
                maxLines = 3,
            )
            Text(
                state.playback.artist ?: state.playback.programName ?: station.country?.uppercase().orEmpty(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
            if (state.playback.errorMessage != null) {
                Text(
                    state.playback.errorMessage,
                    color = MaterialTheme.colorScheme.error,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }

        DividerLine()
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { onFavorite(station) }) {
                val favorite = state.favorites.any { it.id == station.id }
                Icon(
                    if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = if (favorite) "Remove favorite" else "Add favorite",
                    tint = if (favorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = onToggle,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.onBackground,
                    contentColor = MaterialTheme.colorScheme.background,
                ),
                modifier = Modifier.size(58.dp),
                contentPadding = ButtonDefaults.ContentPadding,
            ) {
                Icon(
                    if (state.playback.state == PlayerState.Playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = if (state.playback.state == PlayerState.Playing) "Pause" else "Play",
                )
            }
            TextButton(onClick = onSleep) {
                Text(
                    if (state.sleepMinutes > 0) "${state.sleepMinutes}m" else "Sleep",
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                )
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
            .padding(top = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Add station", fontSize = 22.sp, fontWeight = FontWeight.Medium)
        CompactTextField(name, { name = it }, "Name")
        CompactTextField(stream, { stream = it }, "Stream URL")
        CompactTextField(homepage, { homepage = it }, "Homepage")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CompactTextField(country, { country = it }, "Country", Modifier.weight(0.35f))
            CompactTextField(tags, { tags = it }, "Tags", Modifier.weight(0.65f))
        }
        if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Button(
                onClick = { onSave(name, stream, homepage, country, tags) { error = it } },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.onBackground,
                    contentColor = MaterialTheme.colorScheme.background,
                ),
            ) {
                Text("Save")
            }
        }
    }
}

@Composable
private fun CompactTextField(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier.fillMaxWidth(),
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        modifier = modifier,
        label = { Text(label) },
        singleLine = true,
        shape = RoundedCornerShape(8.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.outline,
            unfocusedBorderColor = MaterialTheme.colorScheme.outline,
            focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant,
        ),
    )
}

@Composable
private fun BottomTabBar(
    tab: AppTab,
    onTab: (AppTab) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background),
    ) {
        DividerLine()
        Row(Modifier.fillMaxWidth()) {
            BottomTabButton(
                selected = tab == AppTab.Browse,
                icon = Icons.Rounded.Public,
                label = "Browse",
                onClick = { onTab(AppTab.Browse) },
                modifier = Modifier.weight(1f),
            )
            BottomTabButton(
                selected = tab == AppTab.Library,
                icon = Icons.Rounded.Favorite,
                label = "Library",
                onClick = { onTab(AppTab.Library) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun BottomTabButton(
    selected: Boolean,
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .clickable(onClick = onClick)
            .padding(top = 0.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .height(1.dp)
                .width(24.dp)
                .background(if (selected) MaterialTheme.colorScheme.onBackground else Color.Transparent),
        )
        Icon(
            icon,
            contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .padding(top = 9.dp)
                .size(21.dp),
        )
        Text(
            label.uppercase(),
            color = if (selected) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 9.5.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            letterSpacing = 1.1.sp,
        )
    }
}

@Composable
private fun FilterCell(
    label: String,
    content: @Composable () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        content()
        Text(
            label.uppercase(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 9.5.sp,
            fontWeight = FontWeight.Medium,
            fontFamily = FontFamily.Monospace,
            letterSpacing = 1.1.sp,
        )
    }
}

@Composable
private fun RoundFilterButton(
    icon: ImageVector,
    active: Boolean,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(if (active) MaterialTheme.colorScheme.onBackground else Color.Transparent)
            .border(
                BorderStroke(1.dp, if (active) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.outline),
                CircleShape,
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(17.dp),
        )
    }
}

@Composable
private fun CircleIconButton(
    icon: ImageVector,
    label: String,
    size: Int = 28,
    iconSize: Int = 14,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
            modifier = Modifier.size(iconSize.dp),
        )
    }
}

@Composable
private fun StationAvatar(
    station: Station?,
    size: Int = 42,
    imageUrl: String? = station?.favicon,
) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.28f)), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials(station?.name.orEmpty()),
            color = MaterialTheme.colorScheme.primary,
            fontSize = (size * 0.26f).sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        ResolvedAsyncImage(
            url = imageUrl,
            contentDescription = station?.name,
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop,
        )
    }
}

@Composable
private fun Artwork(
    station: Station,
    imageUrl: String?,
) {
    Box(
        Modifier
            .size(220.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials(station.name),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 52.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        ResolvedAsyncImage(
            url = imageUrl,
            contentDescription = station.name,
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop,
        )
    }
}

@Composable
private fun ResolvedAsyncImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier,
    contentScale: ContentScale,
) {
    val resolved = resolveImageUrl(url) ?: return
    AsyncImage(
        model = resolved,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
    )
}

@Composable
private fun LiveBars() {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        listOf(10, 16, 8).forEach { height ->
            Box(
                Modifier
                    .width(3.dp)
                    .height(height.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
            )
        }
    }
}

@Composable
private fun DividerLine() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outline),
    )
}

@Composable
private fun EmptyState(
    title: String,
    description: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Text(
            description,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
            textAlign = TextAlign.Center,
        )
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

private fun searchPlaceholder(state: RrradioUiState): String = when {
    state.tab == AppTab.Library && state.librarySource == LibrarySource.Favorites -> "Search your favorites..."
    state.tab == AppTab.Library && state.librarySource == LibrarySource.Recents -> "Search recently played..."
    else -> "Search stations, genres, places..."
}

private fun capabilityStars(station: Station): String = when (station.status) {
    StationStatus.Working -> "***"
    StationStatus.IcyOnly -> "**"
    StationStatus.StreamOnly -> "*"
    null -> ""
}

private fun tagLine(station: Station): String {
    val parts = buildList {
        station.country?.uppercase()?.let(::add)
        station.codec?.takeIf { it.isNotBlank() }?.let(::add)
        station.bitrate?.let { add("${it}k") }
        station.tags.orEmpty().take(4).forEach(::add)
    }
    return parts.joinToString(" . ").ifEmpty { "stream" }.lowercase()
}

private fun resolveImageUrl(url: String?): String? {
    val value = url?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (value.startsWith("https://") || value.startsWith("http://")) return value
    return "https://rrradio.org/${value.removePrefix("/")}"
}

private fun trackLine(playback: PlaybackUiState): String? {
    if (playback.state == PlayerState.Loading) return null
    if (!playback.title.isNullOrBlank() && !playback.artist.isNullOrBlank()) {
        return "${playback.artist} - ${playback.title}"
    }
    if (!playback.title.isNullOrBlank()) return playback.title
    return null
}

private fun stateLine(playback: PlaybackUiState): String = when (playback.state) {
    PlayerState.Idle -> playback.station?.country?.uppercase() ?: "Standby"
    PlayerState.Loading -> "Loading"
    PlayerState.Playing -> "Live"
    PlayerState.Paused -> "Paused"
    PlayerState.Error -> "Error"
}

private fun initials(name: String): String {
    val letters = name
        .split(Regex("\\s+"))
        .filter { it.isNotBlank() }
        .take(2)
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString("")
    return letters.ifBlank { "RR" }
}
