package org.rrradio.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import org.rrradio.android.R
import org.rrradio.android.data.AppThemePreference
import org.rrradio.android.data.CatalogLoadState
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.Station
import org.rrradio.android.data.StationList
import org.rrradio.android.data.countryDisplayName

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RrradioApp(
    state: RrradioUiState,
    actions: RrradioViewModel,
    resolvedDarkTheme: Boolean,
) {
    var showAddStation by remember { mutableStateOf(false) }
    var showNowPlaying by remember { mutableStateOf(false) }
    var showChooseStationList by remember { mutableStateOf(false) }
    var showCreateStationList by remember { mutableStateOf(false) }
    var createListFromSelection by remember { mutableStateOf(false) }
    var customStationPendingDelete by remember { mutableStateOf<Station?>(null) }
    var stationListPendingDelete by remember { mutableStateOf<String?>(null) }

    Scaffold(
        contentWindowInsets = WindowInsets(0),
        bottomBar = {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background)
                    .navigationBarsPadding(),
            ) {
                if (state.stationSelectionActive) {
                    StationSelectionBar(
                        count = state.selectedStationIds.size,
                        onCancel = actions::cancelStationSelection,
                        onSave = {
                            if (state.selectedStationIds.isEmpty()) {
                                actions.cancelStationSelection()
                            } else if (state.stationLists.isEmpty()) {
                                createListFromSelection = true
                                showCreateStationList = true
                            } else {
                                showChooseStationList = true
                            }
                        },
                    )
                } else if (state.playback.station != null) {
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
                onThemePreference = actions::setThemePreference,
                resolvedDarkTheme = resolvedDarkTheme,
                onAddStation = { showAddStation = true },
                onCountry = actions::setCountry,
                onTag = actions::setTag,
                onLibrarySource = actions::setLibrarySource,
                onFavoritesDisplayMode = actions::setFavoritesDisplayMode,
                onBeginStationSelection = actions::beginStationSelection,
                onCreateStationList = {
                    createListFromSelection = false
                    showCreateStationList = true
                },
            )
            StationContent(
                state = state,
                onRefresh = actions::refreshCatalog,
                onPlay = {
                    actions.play(it)
                    showNowPlaying = true
                },
                onFavorite = actions::toggleFavorite,
                onRemoveCustom = { customStationPendingDelete = it },
                onOpenFavorites = { actions.setTab(AppTab.Favorites) },
                onOpenRecents = { actions.setLibrarySource(LibrarySource.Recents) },
                onOpenStationList = actions::openStationList,
                onCloseStationList = actions::closeStationList,
                onDeleteStationList = { stationListPendingDelete = it },
                onRemoveFromStationList = actions::removeStationFromSelectedList,
                onToggleSelection = actions::toggleStationSelection,
                onMoveFavorite = actions::moveFavorite,
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

    if (showChooseStationList) {
        ModalBottomSheet(
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background,
            dragHandle = null,
            onDismissRequest = { showChooseStationList = false },
        ) {
            ChooseStationListSheet(
                stationLists = state.stationLists,
                selectedCount = state.selectedStationIds.size,
                onChoose = { listId ->
                    actions.saveSelectedStationsToList(listId)
                    showChooseStationList = false
                },
                onCreate = {
                    showChooseStationList = false
                    createListFromSelection = true
                    showCreateStationList = true
                },
                onCancel = { showChooseStationList = false },
            )
        }
    }

    if (showCreateStationList) {
        CreateStationListDialog(
            title = if (createListFromSelection) "Save to new list" else "Create list",
            confirmLabel = if (createListFromSelection) "Save" else "Create",
            onDismiss = {
                showCreateStationList = false
                createListFromSelection = false
            },
            onCreate = { name ->
                actions.createStationList(name, includeSelectedStations = createListFromSelection)
                showCreateStationList = false
                createListFromSelection = false
            },
        )
    }

    customStationPendingDelete?.let { station ->
        AlertDialog(
            onDismissRequest = { customStationPendingDelete = null },
            title = { Text("Delete station?") },
            text = { Text("Remove ${station.name} from your custom stations.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        actions.removeCustom(station)
                        customStationPendingDelete = null
                    },
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { customStationPendingDelete = null }) {
                    Text("Cancel")
                }
            },
        )
    }

    stationListPendingDelete?.let { listId ->
        val list = state.stationLists.firstOrNull { it.id == listId }
        AlertDialog(
            onDismissRequest = { stationListPendingDelete = null },
            title = { Text("Delete list?") },
            text = { Text("Remove ${list?.name ?: "this list"} from your station lists.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        actions.removeStationList(listId)
                        stationListPendingDelete = null
                    },
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { stationListPendingDelete = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

@Composable
private fun Header(
    state: RrradioUiState,
    onQuery: (String) -> Unit,
    onThemePreference: (AppThemePreference) -> Unit,
    resolvedDarkTheme: Boolean,
    onAddStation: () -> Unit,
    onCountry: (String?) -> Unit,
    onTag: (String?) -> Unit,
    onLibrarySource: (LibrarySource) -> Unit,
    onFavoritesDisplayMode: (FavoritesDisplayMode) -> Unit,
    onBeginStationSelection: () -> Unit,
    onCreateStationList: () -> Unit,
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
                    .clip(RoundedCornerShape(8.dp))
                    .clickable {
                        onQuery("")
                        onCountry(null)
                        onTag(null)
                        onLibrarySource(LibrarySource.Favorites)
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                BrandLogo(darkTheme = resolvedDarkTheme)
                Text(
                    text = when (state.tab) {
                        AppTab.StationLists -> state.selectedStationList?.name ?: "Lists"
                        AppTab.Browse -> "Browse"
                        AppTab.Favorites -> "Favorites"
                    },
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ThemePreferenceButton(
                    selected = state.themePreference,
                    resolvedDarkTheme = resolvedDarkTheme,
                    onSelected = onThemePreference,
                )
                if (state.tab == AppTab.Browse) {
                    CircleIconButton(
                        icon = Icons.AutoMirrored.Rounded.Article,
                        label = "Add stations to list",
                        onClick = onBeginStationSelection,
                    )
                }
                CircleIconButton(
                    icon = Icons.Rounded.Add,
                    label = if (state.tab == AppTab.StationLists) "Create list" else "Add custom station",
                    onClick = if (state.tab == AppTab.StationLists) onCreateStationList else onAddStation,
                )
            }
        }

        SearchField(
            query = state.query,
            placeholder = searchPlaceholder(state),
            onQuery = onQuery,
        )

        when (state.tab) {
            AppTab.StationLists -> StationListsToolbar(state)
            AppTab.Browse -> BrowseFilters(state, onCountry, onTag, onLibrarySource)
            AppTab.Favorites -> FavoritesDisplayModeSelector(
                selected = state.favoritesDisplayMode,
                onSelected = onFavoritesDisplayMode,
            )
        }

        SectionStatus(state)
    }
}

@Composable
private fun BrandLogo(darkTheme: Boolean) {
    Image(
        painter = painterResource(
            id = if (darkTheme) R.drawable.rrradio_logo_app_dark else R.drawable.rrradio_logo_app_light,
        ),
        contentDescription = null,
        modifier = Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(8.dp)),
    )
}

@Composable
private fun ThemePreferenceButton(
    selected: AppThemePreference,
    resolvedDarkTheme: Boolean,
    onSelected: (AppThemePreference) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        CircleIconButton(
            icon = themePreferenceIcon(selected, resolvedDarkTheme),
            label = "Theme",
            onClick = { expanded = true },
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            AppThemePreference.entries.forEach { preference ->
                DropdownMenuItem(
                    text = { Text(themePreferenceLabel(preference)) },
                    leadingIcon = {
                        Icon(
                            themePreferenceIcon(preference, resolvedDarkTheme),
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                    },
                    trailingIcon = {
                        if (preference == selected) {
                            Icon(
                                Icons.Rounded.Check,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    },
                    onClick = {
                        expanded = false
                        onSelected(preference)
                    },
                )
            }
        }
    }
}

private fun themePreferenceLabel(preference: AppThemePreference): String = when (preference) {
    AppThemePreference.System -> "System"
    AppThemePreference.Light -> "Light"
    AppThemePreference.Dark -> "Dark"
}

private fun themePreferenceIcon(
    preference: AppThemePreference,
    resolvedDarkTheme: Boolean,
): ImageVector = when (preference) {
    AppThemePreference.System -> if (resolvedDarkTheme) Icons.Rounded.DarkMode else Icons.Rounded.LightMode
    AppThemePreference.Light -> Icons.Rounded.LightMode
    AppThemePreference.Dark -> Icons.Rounded.DarkMode
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

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LibrarySegments(
            source = state.librarySource,
            onLibrarySource = {
                onLibrarySource(it)
                if (it == LibrarySource.Recents) {
                    onCountry(null)
                    onTag(null)
                }
            },
        )
        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(scroll),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrowseFilterChip(
                label = "News",
                icon = Icons.AutoMirrored.Rounded.Article,
                active = state.selectedTag == "news",
                onClick = { onTag(if (state.selectedTag == "news") null else "news") },
            )
            Box {
                BrowseFilterChip(
                    label = state.selectedTag?.takeIf { it != "news" } ?: "Genre",
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
            Box {
                BrowseFilterChip(
                    label = state.selectedCountry?.let { countryDisplayName(it) } ?: "Country",
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
            if (state.selectedCountry != null || state.selectedTag != null) {
                BrowseFilterChip(
                    label = "Clear",
                    icon = Icons.Rounded.Close,
                    active = false,
                    onClick = {
                        onCountry(null)
                        onTag(null)
                    },
                )
            }
        }
    }
}

@Composable
private fun BrowseFilterChip(
    label: String,
    icon: ImageVector,
    active: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant)
            .border(
                BorderStroke(
                    1.dp,
                    if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.54f) else MaterialTheme.colorScheme.outline,
                ),
                CircleShape,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
        Text(
            label,
            color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun StationListsToolbar(state: RrradioUiState) {
    val selectedList = state.selectedStationList
    if (selectedList != null) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ListSummaryChip("Stations", selectedList.stations.size, Icons.AutoMirrored.Rounded.Article)
        }
        return
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ListSummaryChip("Favorites", state.favorites.size, Icons.Rounded.Favorite)
        ListSummaryChip("Played", state.recents.size, Icons.Rounded.BarChart)
        ListSummaryChip("Custom", state.customStations.size, Icons.Rounded.Add)
    }
}

@Composable
private fun ListSummaryChip(
    label: String,
    count: Int,
    icon: ImageVector,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
        Text(
            "$label $count",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun FavoritesDisplayModeSelector(
    selected: FavoritesDisplayMode,
    onSelected: (FavoritesDisplayMode) -> Unit,
) {
    Row(
        Modifier
            .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        FavoritesDisplayModeButton(
            mode = FavoritesDisplayMode.List,
            icon = Icons.AutoMirrored.Rounded.Article,
            selected = selected == FavoritesDisplayMode.List,
            onClick = onSelected,
        )
        FavoritesDisplayModeButton(
            mode = FavoritesDisplayMode.Tiles,
            icon = Icons.Rounded.Public,
            selected = selected == FavoritesDisplayMode.Tiles,
            onClick = onSelected,
        )
        FavoritesDisplayModeButton(
            mode = FavoritesDisplayMode.App,
            icon = Icons.Rounded.Star,
            selected = selected == FavoritesDisplayMode.App,
            onClick = onSelected,
        )
    }
}

@Composable
private fun FavoritesDisplayModeButton(
    mode: FavoritesDisplayMode,
    icon: ImageVector,
    selected: Boolean,
    onClick: (FavoritesDisplayMode) -> Unit,
) {
    Box(
        Modifier
            .size(width = 38.dp, height = 30.dp)
            .clip(CircleShape)
            .background(if (selected) MaterialTheme.colorScheme.onBackground else Color.Transparent)
            .clickable { onClick(mode) },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = "${mode.name} favorites view",
            tint = if (selected) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
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
            label = "All stations",
            selected = source == LibrarySource.Favorites,
            onClick = { onLibrarySource(LibrarySource.Favorites) },
            modifier = Modifier.weight(1f),
        )
        SegmentButton(
            label = "Recent",
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
            label,
            color = if (selected) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun SectionStatus(state: RrradioUiState) {
    val selectedList = state.selectedStationList
    val label = when {
        state.tab == AppTab.StationLists && selectedList != null -> selectedList.name
        state.tab == AppTab.StationLists -> "Your lists"
        state.tab == AppTab.Favorites -> "Favorites"
        state.tab == AppTab.Browse && state.librarySource == LibrarySource.Recents -> "Recently played"
        state.query.trim().isNotEmpty() || state.selectedCountry != null || state.selectedTag != null -> "Results"
        else -> "All stations"
    }
    val count = when (state.tab) {
        AppTab.StationLists -> if (selectedList != null) state.visibleStations.size else state.stationLists.size + 3
        else -> state.visibleStations.size
    }
    val countLabel = if (state.tab == AppTab.StationLists && selectedList == null) {
        if (count == 1) "1 list" else "$count lists"
    } else {
        if (count == 1) "1 station" else "$count stations"
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
        Text(
            countLabel,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
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
    onOpenFavorites: () -> Unit,
    onOpenRecents: () -> Unit,
    onOpenStationList: (String) -> Unit,
    onCloseStationList: () -> Unit,
    onDeleteStationList: (String) -> Unit,
    onRemoveFromStationList: (Station) -> Unit,
    onToggleSelection: (Station) -> Unit,
    onMoveFavorite: (Station, Int) -> Unit,
) {
    when {
        state.tab == AppTab.StationLists -> {
            StationListsContent(
                state = state,
                onOpenFavorites = onOpenFavorites,
                onOpenRecents = onOpenRecents,
                onOpenStationList = onOpenStationList,
                onCloseStationList = onCloseStationList,
                onDeleteStationList = onDeleteStationList,
                onPlay = onPlay,
                onRemoveFromStationList = onRemoveFromStationList,
            )
        }

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

        state.tab == AppTab.Favorites -> FavoritesContent(state, onPlay, onFavorite, onRemoveCustom, onMoveFavorite)

        else -> StationListContent(state, onPlay, onFavorite, onRemoveCustom, onToggleSelection)
    }
}

@Composable
private fun StationListContent(
    state: RrradioUiState,
    onPlay: (Station) -> Unit,
    onFavorite: (Station) -> Unit,
    onRemoveCustom: (Station) -> Unit,
    onToggleSelection: (Station) -> Unit = {},
    onMoveFavorite: ((Station, Int) -> Unit)? = null,
) {
    val favoritesCanReorder = onMoveFavorite != null &&
        state.tab == AppTab.Favorites &&
        state.query.isBlank() &&
        state.selectedCountry == null &&
        state.selectedTag == null
    LazyColumn(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(state.visibleStations, key = { it.id }) { station ->
            StationRow(
                station = station,
                isPlaying = state.playback.station?.id == station.id && state.playback.state == PlayerState.Playing,
                isCurrent = state.playback.station?.id == station.id,
                isFavorite = state.favorites.any { it.id == station.id },
                isCustom = state.customStations.any { it.id == station.id },
                selectionMode = state.stationSelectionActive,
                selected = station.id in state.selectedStationIds,
                canMoveUp = favoritesCanReorder && state.visibleStations.indexOf(station) > 0,
                canMoveDown = favoritesCanReorder && state.visibleStations.indexOf(station) < state.visibleStations.lastIndex,
                onPlay = {
                    if (state.stationSelectionActive) onToggleSelection(station) else onPlay(station)
                },
                onFavorite = { onFavorite(station) },
                onRemoveCustom = { onRemoveCustom(station) },
                onMoveUp = { onMoveFavorite?.invoke(station, -1) },
                onMoveDown = { onMoveFavorite?.invoke(station, 1) },
            )
        }
    }
}

@Composable
private fun StationListsContent(
    state: RrradioUiState,
    onOpenFavorites: () -> Unit,
    onOpenRecents: () -> Unit,
    onOpenStationList: (String) -> Unit,
    onCloseStationList: () -> Unit,
    onDeleteStationList: (String) -> Unit,
    onPlay: (Station) -> Unit,
    onRemoveFromStationList: (Station) -> Unit,
) {
    val selectedList = state.selectedStationList
    if (selectedList != null) {
        val listStations = state.visibleStations
        LazyColumn(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                StationListDetailActions(
                    list = selectedList,
                    onBack = onCloseStationList,
                    onDelete = { onDeleteStationList(selectedList.id) },
                )
            }
            if (selectedList.stations.isEmpty()) {
                item {
                    EmptyState(
                        title = "Empty station list",
                        description = "Add stations from Browse with the list button.",
                    )
                }
            } else if (listStations.isEmpty()) {
                item {
                    EmptyState(
                        title = "No stations found",
                        description = "Try a different station name, country code, or tag.",
                    )
                }
            } else {
                items(listStations, key = { it.id }) { station ->
                    StationRow(
                        station = station,
                        isPlaying = state.playback.station?.id == station.id && state.playback.state == PlayerState.Playing,
                        isCurrent = state.playback.station?.id == station.id,
                        isFavorite = state.favorites.any { it.id == station.id },
                        isCustom = false,
                        onPlay = { onPlay(station) },
                        onFavorite = {},
                        onRemoveCustom = {},
                        onMoveUp = {},
                        onMoveDown = {},
                        onRemoveFromList = { onRemoveFromStationList(station) },
                    )
                }
            }
        }
        return
    }

    LazyColumn(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            StationListSummaryRow(
                title = "Favorites",
                subtitle = "${state.favorites.size} saved stations",
                icon = Icons.Rounded.Favorite,
                onClick = onOpenFavorites,
            )
        }
        item {
            StationListSummaryRow(
                title = "Recently played",
                subtitle = "${state.recents.size} stations",
                icon = Icons.Rounded.BarChart,
                onClick = onOpenRecents,
            )
        }
        item {
            StationListSummaryRow(
                title = "Custom stations",
                subtitle = "${state.customStations.size} manually added",
                icon = Icons.Rounded.Add,
            )
        }
        items(state.stationLists, key = { it.id }) { list ->
            StationListSummaryRow(
                title = list.name,
                subtitle = "${list.stations.size} stations",
                icon = Icons.AutoMirrored.Rounded.Article,
                onClick = { onOpenStationList(list.id) },
            )
        }
        if (state.stationLists.isEmpty()) {
            item {
                Text(
                    "Create a list to collect stations outside favorites.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun StationListDetailActions(
    list: StationList,
    onBack: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        TextButton(onClick = onBack) { Text("All lists") }
        Text(
            "${list.stations.size} stations",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
            Icon(
                Icons.Rounded.Delete,
                contentDescription = "Delete list",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun StationListSummaryRow(
    title: String,
    subtitle: String,
    icon: ImageVector,
    onClick: (() -> Unit)? = null,
) {
    val clickableModifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(8.dp))
            .then(clickableModifier)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .size(46.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(23.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = MaterialTheme.colorScheme.onBackground, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text(
                subtitle.uppercase(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
private fun FavoritesContent(
    state: RrradioUiState,
    onPlay: (Station) -> Unit,
    onFavorite: (Station) -> Unit,
    onRemoveCustom: (Station) -> Unit,
    onMoveFavorite: (Station, Int) -> Unit,
) {
    when (state.favoritesDisplayMode) {
        FavoritesDisplayMode.List -> StationListContent(
            state = state,
            onPlay = onPlay,
            onFavorite = onFavorite,
            onRemoveCustom = onRemoveCustom,
            onMoveFavorite = onMoveFavorite,
        )
        FavoritesDisplayMode.Tiles -> FavoritesTileGrid(state, onPlay, onFavorite)
        FavoritesDisplayMode.App -> FavoritesAppGrid(state, onPlay)
    }
}

@Composable
private fun FavoritesTileGrid(
    state: RrradioUiState,
    onPlay: (Station) -> Unit,
    onFavorite: (Station) -> Unit,
) {
    LazyColumn(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(state.visibleStations.chunked(2), key = { row -> row.joinToString("-") { it.id } }) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { station ->
                    FavoriteTile(
                        station = station,
                        isPlaying = state.playback.station?.id == station.id && state.playback.state == PlayerState.Playing,
                        onPlay = { onPlay(station) },
                        onFavorite = { onFavorite(station) },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun FavoriteTile(
    station: Station,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    onFavorite: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .aspectRatio(1.05f)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(8.dp))
            .clickable(onClick = onPlay)
            .padding(14.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.Top) {
            StationAvatar(station, size = 74, imageUrl = station.favicon)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onFavorite, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Rounded.Favorite,
                    contentDescription = "Remove favorite",
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    station.name,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (isPlaying) LiveBars()
            }
            Text(
                tagLine(station),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun FavoritesAppGrid(
    state: RrradioUiState,
    onPlay: (Station) -> Unit,
) {
    LazyColumn(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        items(state.visibleStations.chunked(4), key = { row -> row.joinToString("-") { it.id } }) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { station ->
                    FavoriteAppIcon(
                        station = station,
                        isPlaying = state.playback.station?.id == station.id && state.playback.state == PlayerState.Playing,
                        onPlay = { onPlay(station) },
                        modifier = Modifier.weight(1f),
                    )
                }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun FavoriteAppIcon(
    station: Station,
    isPlaying: Boolean,
    onPlay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.clickable(onClick = onPlay),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box {
            AppLogo(station)
            if (isPlaying) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
                    contentAlignment = Alignment.Center,
                ) {
                    LiveBars()
                }
            }
        }
        Text(
            station.name,
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun AppLogo(station: Station) {
    Box(
        Modifier
            .size(64.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials(station.name),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        ResolvedAsyncImage(
            url = station.favicon,
            contentDescription = station.name,
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop,
        )
    }
}

@Composable
private fun StationRow(
    station: Station,
    isPlaying: Boolean,
    isCurrent: Boolean,
    isFavorite: Boolean,
    isCustom: Boolean,
    selectionMode: Boolean = false,
    selected: Boolean = false,
    canMoveUp: Boolean = false,
    canMoveDown: Boolean = false,
    onPlay: () -> Unit,
    onFavorite: () -> Unit,
    onRemoveCustom: () -> Unit,
    onMoveUp: () -> Unit = {},
    onMoveDown: () -> Unit = {},
    onRemoveFromList: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(14.dp))
            .clickable(onClick = onPlay)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StationAvatar(station, size = 48, imageUrl = station.favicon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
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
                    CountryPill(it)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    stationDetailLine(station),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                )
            }
        }
        if (isPlaying) LiveBars()
        when {
            selectionMode -> {
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                        .border(
                            BorderStroke(
                                1.dp,
                                if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                            ),
                            CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (selected) {
                        Icon(
                            Icons.Rounded.Check,
                            contentDescription = "Selected",
                            tint = MaterialTheme.colorScheme.background,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
            onRemoveFromList != null -> {
                IconButton(onClick = onRemoveFromList, modifier = Modifier.size(34.dp)) {
                    Icon(
                        Icons.Rounded.Close,
                        contentDescription = "Remove from list",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            canMoveUp || canMoveDown -> {
                Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    IconButton(
                        onClick = onMoveUp,
                        enabled = canMoveUp,
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Rounded.KeyboardArrowUp,
                            contentDescription = "Move favorite up",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (canMoveUp) 1f else 0.28f),
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    IconButton(
                        onClick = onMoveDown,
                        enabled = canMoveDown,
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Rounded.KeyboardArrowDown,
                            contentDescription = "Move favorite down",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (canMoveDown) 1f else 0.28f),
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            else -> {
                IconButton(onClick = onFavorite, modifier = Modifier.size(36.dp)) {
                    Icon(
                        if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                        contentDescription = if (isFavorite) "Remove favorite" else "Add favorite",
                        tint = if (isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(19.dp),
                    )
                }
            }
        }
        if (isCustom && !selectionMode) {
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
private fun CountryPill(country: String) {
    Text(
        country.uppercase(),
        color = MaterialTheme.colorScheme.primary,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        fontFamily = FontFamily.Monospace,
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
            .padding(horizontal = 7.dp, vertical = 3.dp),
    )
}

@Composable
private fun StationSelectionBar(
    count: Int,
    onCancel: () -> Unit,
    onSave: () -> Unit,
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
                .padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Check,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    "$count selected",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    "SAVE TO STATION LIST",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Medium,
                    fontFamily = FontFamily.Monospace,
                )
            }
            TextButton(onClick = onCancel) { Text("Cancel") }
            Button(
                onClick = onSave,
                enabled = count > 0,
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
private fun ChooseStationListSheet(
    stationLists: List<StationList>,
    selectedCount: Int,
    onChoose: (String) -> Unit,
    onCreate: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 24.dp)
            .padding(top = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Save to list", fontSize = 22.sp, fontWeight = FontWeight.Medium)
        Text(
            "$selectedCount stations selected",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
        )
        stationLists.forEach { list ->
            StationListSummaryRow(
                title = list.name,
                subtitle = "${list.stations.size} stations",
                icon = Icons.AutoMirrored.Rounded.Article,
                onClick = { onChoose(list.id) },
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Button(
                onClick = onCreate,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.onBackground,
                    contentColor = MaterialTheme.colorScheme.background,
                ),
            ) {
                Text("New list")
            }
        }
    }
}

@Composable
private fun CreateStationListDialog(
    title: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            CompactTextField(
                value = name,
                onValue = { name = it },
                label = "List name",
            )
        },
        confirmButton = {
            TextButton(onClick = { onCreate(name) }) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
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
                selected = tab == AppTab.StationLists,
                icon = Icons.AutoMirrored.Rounded.Article,
                label = "Lists",
                onClick = { onTab(AppTab.StationLists) },
                modifier = Modifier.weight(1f),
            )
            BottomTabButton(
                selected = tab == AppTab.Browse,
                icon = Icons.Rounded.Public,
                label = "Browse",
                onClick = { onTab(AppTab.Browse) },
                modifier = Modifier.weight(1f),
            )
            BottomTabButton(
                selected = tab == AppTab.Favorites,
                icon = Icons.Rounded.Favorite,
                label = "Favorites",
                onClick = { onTab(AppTab.Favorites) },
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
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else Color.Transparent)
            .padding(top = 0.dp, bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .height(2.dp)
                .fillMaxWidth(0.5f)
                .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent),
        )
        Icon(
            icon,
            contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .padding(top = 9.dp)
                .size(21.dp),
        )
        Text(
            label,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
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

private fun searchPlaceholder(state: RrradioUiState): String {
    val selectedList = state.selectedStationList
    return when {
        state.tab == AppTab.StationLists && selectedList != null -> "Search ${selectedList.name}..."
        state.tab == AppTab.StationLists -> "Search station lists..."
        state.tab == AppTab.Favorites -> "Search your favorites..."
        state.tab == AppTab.Browse && state.librarySource == LibrarySource.Recents -> "Search recently played..."
        else -> "Search stations, genres, places..."
    }
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

private fun stationDetailLine(station: Station): String {
    val parts = buildList {
        station.codec?.takeIf { it.isNotBlank() }?.let(::add)
        station.bitrate?.let { add("${it} kbps") }
        station.tags.orEmpty().take(3).forEach(::add)
        if (isEmpty()) add("Stream")
    }
    return parts.joinToString(" / ")
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
