package org.rrradio.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.material.icons.rounded.Edit
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
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Timer
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
import org.rrradio.android.data.AccentPreference
import org.rrradio.android.data.AppThemePreference
import org.rrradio.android.data.BrowseStationSort
import org.rrradio.android.data.CatalogLoadState
import org.rrradio.android.data.FavoritesDisplayMode
import org.rrradio.android.data.LandingPagePreference
import org.rrradio.android.data.LibraryRepository
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.Station
import org.rrradio.android.data.StationList
import org.rrradio.android.data.StationStatus
import org.rrradio.android.data.countryDisplayName
import org.rrradio.android.data.displayName
import org.rrradio.android.data.streamQualityLevel
import org.rrradio.android.ui.theme.rrradioAccentColor

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
    var showPreferences by remember { mutableStateOf(false) }
    var createListFromSelection by remember { mutableStateOf(false) }
    var customStationPendingDelete by remember { mutableStateOf<Station?>(null) }
    var stationListPendingDelete by remember { mutableStateOf<String?>(null) }
    var stationListPendingRename by remember { mutableStateOf<StationList?>(null) }
    var stationPreview by remember { mutableStateOf<Station?>(null) }

    Box(Modifier.fillMaxSize()) {
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
                    onOpenPreferences = { showPreferences = true },
                    resolvedDarkTheme = resolvedDarkTheme,
                    onAddStation = { showAddStation = true },
                    onCountry = actions::setCountry,
                    onTag = actions::setTag,
                    onLibrarySource = actions::setLibrarySource,
                    onFavoritesDisplayMode = actions::setFavoritesDisplayMode,
                    onCycleAlphabetSort = actions::cycleAlphabetSort,
                    onCycleQualitySort = actions::cycleQualitySort,
                    onCycleFavoriteSort = actions::cycleFavoriteSort,
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
                    onRenameStationList = { stationListPendingRename = it },
                    onRemoveFromStationList = actions::removeStationFromSelectedList,
                    onMoveStationList = actions::moveStationList,
                    onMoveStationInList = actions::moveStationInSelectedList,
                    onToggleSelection = actions::toggleStationSelection,
                    onMoveFavorite = actions::moveFavorite,
                    onPreviewStation = { stationPreview = it },
                )
            }
        }

        if (showNowPlaying && state.playback.station != null) {
            BackHandler { showNowPlaying = false }
            NowPlayingDestination(
                state = state,
                onFavorite = actions::toggleFavorite,
                onPrevious = actions::playPrevious,
                onToggle = actions::togglePlayback,
                onNext = actions::playNext,
                onSleep = actions::cycleSleepTimer,
                onDismiss = { showNowPlaying = false },
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

    stationPreview?.let { station ->
        ModalBottomSheet(
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background,
            dragHandle = null,
            onDismissRequest = { stationPreview = null },
        ) {
            StationInfoSheet(
                station = station,
                playback = state.playback,
                isFavorite = state.favorites.any { it.id == station.id },
                onDismiss = { stationPreview = null },
            )
        }
    }

    if (showPreferences) {
        ModalBottomSheet(
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background,
            dragHandle = null,
            onDismissRequest = { showPreferences = false },
        ) {
            PreferencesSheet(
                state = state,
                resolvedDarkTheme = resolvedDarkTheme,
                onThemePreference = actions::setThemePreference,
                onAccentPreference = actions::setAccentPreference,
                onLandingPagePreference = actions::setLandingPagePreference,
                onSleepDefaultMinutes = actions::setSleepDefaultMinutes,
                onDismiss = { showPreferences = false },
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

    stationListPendingRename?.let { list ->
        CreateStationListDialog(
            title = "Rename list",
            confirmLabel = "Save",
            initialName = list.name,
            onDismiss = { stationListPendingRename = null },
            onCreate = { name ->
                actions.renameStationList(list.id, name)
                stationListPendingRename = null
            },
        )
    }

    customStationPendingDelete?.let { station ->
        AlertDialog(
            onDismissRequest = { customStationPendingDelete = null },
            title = { Text("Delete station?") },
            text = { Text("Remove ${station.displayName()} from your custom stations.") },
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
    onOpenPreferences: () -> Unit,
    resolvedDarkTheme: Boolean,
    onAddStation: () -> Unit,
    onCountry: (String?) -> Unit,
    onTag: (String?) -> Unit,
    onLibrarySource: (LibrarySource) -> Unit,
    onFavoritesDisplayMode: (FavoritesDisplayMode) -> Unit,
    onCycleAlphabetSort: () -> Unit,
    onCycleQualitySort: () -> Unit,
    onCycleFavoriteSort: () -> Unit,
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
                CircleIconButton(
                    icon = Icons.Rounded.Settings,
                    label = "Preferences",
                    onClick = onOpenPreferences,
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
            AppTab.Browse -> BrowseFilters(
                state = state,
                onCountry = onCountry,
                onTag = onTag,
                onLibrarySource = onLibrarySource,
                onCycleAlphabetSort = onCycleAlphabetSort,
                onCycleQualitySort = onCycleQualitySort,
                onCycleFavoriteSort = onCycleFavoriteSort,
            )
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
private fun PreferencesSheet(
    state: RrradioUiState,
    resolvedDarkTheme: Boolean,
    onThemePreference: (AppThemePreference) -> Unit,
    onAccentPreference: (AccentPreference) -> Unit,
    onLandingPagePreference: (LandingPagePreference) -> Unit,
    onSleepDefaultMinutes: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 18.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    "Preferences",
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "Device-local settings",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                )
            }
            CircleIconButton(
                icon = Icons.Rounded.Close,
                label = "Close preferences",
                size = 34,
                iconSize = 16,
                onClick = onDismiss,
            )
        }

        PreferenceSection(title = "Appearance") {
            AppThemePreference.entries.forEachIndexed { index, preference ->
                PreferenceChoiceRow(
                    icon = themePreferenceIcon(preference, resolvedDarkTheme),
                    title = themePreferenceLabel(preference),
                    detail = themePreferenceDetail(preference, resolvedDarkTheme),
                    selected = state.themePreference == preference,
                    onClick = { onThemePreference(preference) },
                )
                if (index != AppThemePreference.entries.lastIndex) PreferenceDivider()
            }
        }

        PreferenceSection(title = "Accent") {
            AccentPreference.entries.forEachIndexed { index, preference ->
                AccentPreferenceRow(
                    preference = preference,
                    resolvedDarkTheme = resolvedDarkTheme,
                    selected = state.accentPreference == preference,
                    onClick = { onAccentPreference(preference) },
                )
                if (index != AccentPreference.entries.lastIndex) PreferenceDivider()
            }
        }

        PreferenceSection(title = "Start") {
            LandingPagePreference.entries.forEachIndexed { index, preference ->
                PreferenceChoiceRow(
                    icon = landingPagePreferenceIcon(preference),
                    title = landingPagePreferenceLabel(preference),
                    detail = landingPagePreferenceDetail(preference),
                    selected = state.landingPagePreference == preference,
                    onClick = { onLandingPagePreference(preference) },
                )
                if (index != LandingPagePreference.entries.lastIndex) PreferenceDivider()
            }
        }

        PreferenceSection(title = "Sleep timer") {
            LibraryRepository.SLEEP_DEFAULT_OPTIONS.forEachIndexed { index, minutes ->
                PreferenceChoiceRow(
                    icon = Icons.Rounded.Timer,
                    title = "$minutes minutes",
                    detail = if (state.sleepDefaultMinutes == minutes) {
                        "First Sleep tap starts here."
                    } else {
                        "Use $minutes minutes as the default."
                    },
                    selected = state.sleepDefaultMinutes == minutes,
                    onClick = { onSleepDefaultMinutes(minutes) },
                )
                if (index != LibraryRepository.SLEEP_DEFAULT_OPTIONS.lastIndex) PreferenceDivider()
            }
        }
    }
}

@Composable
private fun PreferenceSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(8.dp)),
            content = content,
        )
    }
}

@Composable
private fun PreferenceChoiceRow(
    icon: ImageVector,
    title: String,
    detail: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PreferenceLeadingIcon(icon = icon, selected = selected)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                detail,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
        }
        if (selected) {
            Icon(
                Icons.Rounded.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun AccentPreferenceRow(
    preference: AccentPreference,
    resolvedDarkTheme: Boolean,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(30.dp)
                .clip(CircleShape)
                .background(rrradioAccentColor(preference, resolvedDarkTheme))
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                accentPreferenceLabel(preference),
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                accentPreferenceDetail(preference),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
        }
        if (selected) {
            Icon(
                Icons.Rounded.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun PreferenceLeadingIcon(icon: ImageVector, selected: Boolean) {
    Box(
        Modifier
            .size(30.dp)
            .clip(CircleShape)
            .background(
                if (selected) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.20f)
                } else {
                    MaterialTheme.colorScheme.background
                },
            )
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun PreferenceDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.outline),
    )
}

private fun themePreferenceDetail(
    preference: AppThemePreference,
    resolvedDarkTheme: Boolean,
): String = when (preference) {
    AppThemePreference.System -> if (resolvedDarkTheme) {
        "Follow Android. Currently dark."
    } else {
        "Follow Android. Currently light."
    }
    AppThemePreference.Light -> "Always use the light app theme."
    AppThemePreference.Dark -> "Always use the dark app theme."
}

private fun accentPreferenceLabel(preference: AccentPreference): String = when (preference) {
    AccentPreference.Classic -> "Classic"
    AccentPreference.Yellow -> "Yellow"
    AccentPreference.Green -> "Green"
    AccentPreference.Blue -> "Blue"
    AccentPreference.Pink -> "Pink"
}

private fun accentPreferenceDetail(preference: AccentPreference): String = when (preference) {
    AccentPreference.Classic -> "Green in light mode, yellow in dark mode."
    AccentPreference.Yellow -> "Use the night-radio yellow accent everywhere."
    AccentPreference.Green -> "Use the original green accent everywhere."
    AccentPreference.Blue -> "Use a cooler Android accent."
    AccentPreference.Pink -> "Use a warmer high-contrast accent."
}

private fun landingPagePreferenceLabel(preference: LandingPagePreference): String = when (preference) {
    LandingPagePreference.StationLists -> "Lists"
    LandingPagePreference.Browse -> "Browse"
    LandingPagePreference.Favorites -> "Favorites"
}

private fun landingPagePreferenceDetail(preference: LandingPagePreference): String = when (preference) {
    LandingPagePreference.StationLists -> "Open your station lists on launch."
    LandingPagePreference.Browse -> "Open the full catalog on launch."
    LandingPagePreference.Favorites -> "Open your favorite stations on launch."
}

private fun landingPagePreferenceIcon(preference: LandingPagePreference): ImageVector = when (preference) {
    LandingPagePreference.StationLists -> Icons.AutoMirrored.Rounded.Article
    LandingPagePreference.Browse -> Icons.Rounded.Public
    LandingPagePreference.Favorites -> Icons.Rounded.Favorite
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
    onCycleAlphabetSort: () -> Unit,
    onCycleQualitySort: () -> Unit,
    onCycleFavoriteSort: () -> Unit,
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
        if (state.librarySource == LibrarySource.Favorites) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrowseSortChip(
                    label = alphabetSortLabel(state.browseStationSort),
                    icon = Icons.Rounded.KeyboardArrowDown,
                    active = state.browseStationSort == BrowseStationSort.AlphabetAscending ||
                        state.browseStationSort == BrowseStationSort.AlphabetDescending,
                    onClick = onCycleAlphabetSort,
                )
                BrowseSortChip(
                    label = qualitySortLabel(state.browseStationSort),
                    icon = Icons.Rounded.BarChart,
                    active = state.browseStationSort == BrowseStationSort.QualityLow ||
                        state.browseStationSort == BrowseStationSort.QualityHigh,
                    onClick = onCycleQualitySort,
                )
                BrowseSortChip(
                    label = favoriteSortLabel(state.browseStationSort),
                    icon = Icons.Rounded.Favorite,
                    active = state.browseStationSort == BrowseStationSort.FavoritesFirst ||
                        state.browseStationSort == BrowseStationSort.FavoritesLast,
                    onClick = onCycleFavoriteSort,
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
private fun BrowseSortChip(
    label: String,
    icon: ImageVector,
    active: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else Color.Transparent)
            .border(
                BorderStroke(
                    1.dp,
                    if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.54f) else MaterialTheme.colorScheme.outline,
                ),
                CircleShape,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(15.dp),
        )
        Text(
            label,
            color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

private fun alphabetSortLabel(sort: BrowseStationSort?): String = when (sort) {
    BrowseStationSort.AlphabetDescending -> "Z-A"
    else -> "A-Z"
}

private fun qualitySortLabel(sort: BrowseStationSort?): String = when (sort) {
    BrowseStationSort.QualityLow -> "Quality low"
    BrowseStationSort.QualityHigh -> "Quality high"
    else -> "Quality"
}

private fun favoriteSortLabel(sort: BrowseStationSort?): String = when (sort) {
    BrowseStationSort.FavoritesFirst -> "Favorites first"
    BrowseStationSort.FavoritesLast -> "Favorites last"
    else -> "Favorites"
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
    onRenameStationList: (StationList) -> Unit,
    onRemoveFromStationList: (Station) -> Unit,
    onMoveStationList: (StationList, Int) -> Unit,
    onMoveStationInList: (Station, Int) -> Unit,
    onToggleSelection: (Station) -> Unit,
    onMoveFavorite: (Station, Int) -> Unit,
    onPreviewStation: (Station) -> Unit,
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
                onRenameStationList = onRenameStationList,
                onPlay = onPlay,
                onRemoveFromStationList = onRemoveFromStationList,
                onMoveStationList = onMoveStationList,
                onMoveStationInList = onMoveStationInList,
                onPreviewStation = onPreviewStation,
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
                title = emptyStateTitle(state),
                description = emptyStateDescription(state),
            )
        }

        state.tab == AppTab.Favorites -> FavoritesContent(state, onPlay, onFavorite, onRemoveCustom, onMoveFavorite, onPreviewStation)

        else -> StationListContent(state, onPlay, onFavorite, onRemoveCustom, onToggleSelection, onPreviewStation = onPreviewStation)
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
    onPreviewStation: (Station) -> Unit,
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
                onPreview = { if (!state.stationSelectionActive) onPreviewStation(station) },
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
    onRenameStationList: (StationList) -> Unit,
    onPlay: (Station) -> Unit,
    onRemoveFromStationList: (Station) -> Unit,
    onMoveStationList: (StationList, Int) -> Unit,
    onMoveStationInList: (Station, Int) -> Unit,
    onPreviewStation: (Station) -> Unit,
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
                    onRename = { onRenameStationList(selectedList) },
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
                    val stationIndex = selectedList.stations.indexOfFirst { it.id == station.id }
                    StationRow(
                        station = station,
                        isPlaying = state.playback.station?.id == station.id && state.playback.state == PlayerState.Playing,
                        isCurrent = state.playback.station?.id == station.id,
                        isFavorite = state.favorites.any { it.id == station.id },
                        isCustom = false,
                        canMoveUp = stationIndex > 0,
                        canMoveDown = stationIndex >= 0 && stationIndex < selectedList.stations.lastIndex,
                        onPlay = { onPlay(station) },
                        onFavorite = {},
                        onRemoveCustom = {},
                        onMoveUp = { onMoveStationInList(station, -1) },
                        onMoveDown = { onMoveStationInList(station, 1) },
                        onRemoveFromList = { onRemoveFromStationList(station) },
                        moveUpContentDescription = "Move station up",
                        moveDownContentDescription = "Move station down",
                        onPreview = { onPreviewStation(station) },
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
            val index = state.stationLists.indexOfFirst { it.id == list.id }
            StationListSummaryRow(
                title = list.name,
                subtitle = "${list.stations.size} stations",
                icon = Icons.AutoMirrored.Rounded.Article,
                onClick = { onOpenStationList(list.id) },
                trailingContent = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        IconButton(onClick = { onRenameStationList(list) }, modifier = Modifier.size(34.dp)) {
                            Icon(
                                Icons.Rounded.Edit,
                                contentDescription = "Rename list",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(17.dp),
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                            IconButton(
                                onClick = { onMoveStationList(list, -1) },
                                enabled = index > 0,
                                modifier = Modifier.size(28.dp),
                            ) {
                                Icon(
                                    Icons.Rounded.KeyboardArrowUp,
                                    contentDescription = "Move list up",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (index > 0) 1f else 0.28f),
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                            IconButton(
                                onClick = { onMoveStationList(list, 1) },
                                enabled = index >= 0 && index < state.stationLists.lastIndex,
                                modifier = Modifier.size(28.dp),
                            ) {
                                Icon(
                                    Icons.Rounded.KeyboardArrowDown,
                                    contentDescription = "Move list down",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(
                                        alpha = if (index >= 0 && index < state.stationLists.lastIndex) 1f else 0.28f,
                                    ),
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                },
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
    onRename: () -> Unit,
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
        IconButton(onClick = onRename, modifier = Modifier.size(36.dp)) {
            Icon(
                Icons.Rounded.Edit,
                contentDescription = "Rename list",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
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
    trailingContent: (@Composable () -> Unit)? = null,
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
        trailingContent?.invoke()
    }
}

@Composable
private fun FavoritesContent(
    state: RrradioUiState,
    onPlay: (Station) -> Unit,
    onFavorite: (Station) -> Unit,
    onRemoveCustom: (Station) -> Unit,
    onMoveFavorite: (Station, Int) -> Unit,
    onPreviewStation: (Station) -> Unit,
) {
    when (state.favoritesDisplayMode) {
        FavoritesDisplayMode.List -> StationListContent(
            state = state,
            onPlay = onPlay,
            onFavorite = onFavorite,
            onRemoveCustom = onRemoveCustom,
            onMoveFavorite = onMoveFavorite,
            onPreviewStation = onPreviewStation,
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
                    station.displayName(),
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
            station.displayName(),
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
            initials(station.displayName()),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        ResolvedAsyncImage(
            url = station.favicon,
            contentDescription = station.displayName(),
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop,
        )
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
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
    moveUpContentDescription: String = "Move favorite up",
    moveDownContentDescription: String = "Move favorite down",
    onPreview: () -> Unit = {},
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(14.dp))
            .combinedClickable(
                onClick = onPlay,
                onLongClick = onPreview,
            )
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StationAvatar(station, size = 48, imageUrl = station.favicon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    station.displayName(),
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
        if (selectionMode) {
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
        } else {
            if (onRemoveFromList != null) {
                IconButton(onClick = onRemoveFromList, modifier = Modifier.size(34.dp)) {
                    Icon(
                        Icons.Rounded.Close,
                        contentDescription = "Remove from list",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            if (canMoveUp || canMoveDown) {
                Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    IconButton(
                        onClick = onMoveUp,
                        enabled = canMoveUp,
                        modifier = Modifier.size(28.dp),
                    ) {
                        Icon(
                            Icons.Rounded.KeyboardArrowUp,
                            contentDescription = moveUpContentDescription,
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
                            contentDescription = moveDownContentDescription,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (canMoveDown) 1f else 0.28f),
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }
            if (onRemoveFromList == null && !canMoveUp && !canMoveDown) {
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
                    playback.station?.displayName().orEmpty(),
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
private fun NowPlayingDestination(
    state: RrradioUiState,
    onFavorite: (Station) -> Unit,
    onPrevious: () -> Unit,
    onToggle: () -> Unit,
    onNext: () -> Unit,
    onSleep: () -> Unit,
    onDismiss: () -> Unit,
) {
    val station = state.playback.station ?: return
    val canStepStations = state.playback.queueSize > 1
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
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
                    station.displayName(),
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
            horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
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
            IconButton(
                onClick = onPrevious,
                enabled = canStepStations,
            ) {
                Icon(
                    Icons.Rounded.SkipPrevious,
                    contentDescription = "Previous station",
                    tint = if (canStepStations) {
                        MaterialTheme.colorScheme.onBackground
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
                    },
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
            IconButton(
                onClick = onNext,
                enabled = canStepStations,
            ) {
                Icon(
                    Icons.Rounded.SkipNext,
                    contentDescription = "Next station",
                    tint = if (canStepStations) {
                        MaterialTheme.colorScheme.onBackground
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
                    },
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
private fun StationInfoSheet(
    station: Station,
    playback: PlaybackUiState,
    isFavorite: Boolean,
    onDismiss: () -> Unit,
) {
    val isCurrent = playback.station?.id == station.id
    val isPlaying = isCurrent && playback.state == PlayerState.Playing
    val currentLine = if (isCurrent) trackLine(playback) else null
    val programLine = if (isCurrent) stationInfoProgramLine(playback) else null

    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 22.dp)
            .padding(top = 14.dp, bottom = 30.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            StationAvatar(station, size = 58, imageUrl = station.favicon)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    station.displayName(),
                    color = MaterialTheme.colorScheme.onBackground,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                    when {
                        isPlaying -> StationInfoPill("Playing")
                        isCurrent -> StationInfoPill("Loaded")
                    }
                    if (isFavorite) StationInfoPill("Favorite")
                    station.country?.uppercase()?.let { StationInfoPill(it) }
                }
            }
            IconButton(onClick = onDismiss, modifier = Modifier.size(38.dp)) {
                Icon(Icons.Rounded.Close, contentDescription = "Dismiss station info")
            }
        }

        if (currentLine != null || programLine != null) {
            StationInfoSection("Current") {
                currentLine?.let { StationInfoRow("Now playing", it) }
                programLine?.let { StationInfoRow("Program", it) }
            }
        }

        StationInfoSection("Stream") {
            StationInfoRow("Quality", stationInfoQualityLine(station))
            station.status?.let { StationInfoRow("Status", stationStatusLabel(it)) }
            station.listeners?.let { StationInfoRow("Listeners", "%,d".format(it)) }
        }

        StationInfoSection("Catalog") {
            station.country?.takeIf { it.isNotBlank() }?.let {
                StationInfoRow("Country", countryDisplayName(it))
            }
            station.tags.orEmpty().takeIf { it.isNotEmpty() }?.let {
                StationInfoRow("Tags", it.take(8).joinToString(", "))
            }
            station.metadata?.trim()?.takeIf { it.isNotEmpty() }?.let {
                StationInfoRow("Metadata", it)
            }
            station.homepage?.trim()?.takeIf { it.isNotEmpty() }?.let {
                StationInfoRow("Website", it)
            }
        }
    }
}

@Composable
private fun StationInfoSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title.uppercase(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 10.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.4.sp,
        )
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), RoundedCornerShape(8.dp)),
            content = content,
        )
    }
}

@Composable
private fun StationInfoRow(
    label: String,
    value: String,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.width(92.dp),
        )
        Text(
            value,
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 14.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun StationInfoPill(value: String) {
    Text(
        value,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontSize = 10.5.sp,
        fontFamily = FontFamily.Monospace,
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), CircleShape)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    )
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
    initialName: String = "",
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
) {
    var name by remember(initialName) { mutableStateOf(initialName) }
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
            initials(station?.displayName().orEmpty()),
            color = MaterialTheme.colorScheme.primary,
            fontSize = (size * 0.26f).sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        ResolvedAsyncImage(
            url = imageUrl,
            contentDescription = station?.displayName(),
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
            initials(station.displayName()),
            color = MaterialTheme.colorScheme.primary,
            fontSize = 52.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
        )
        ResolvedAsyncImage(
            url = imageUrl,
            contentDescription = station.displayName(),
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

private fun emptyStateTitle(state: RrradioUiState): String = when {
    state.tab == AppTab.Browse && state.librarySource == LibrarySource.Recents -> "No recent stations"
    state.query.isNotBlank() || state.selectedCountry != null || state.selectedTag != null -> "No matching stations"
    state.tab == AppTab.Favorites -> "No favorites yet"
    else -> "No stations found"
}

private fun emptyStateDescription(state: RrradioUiState): String = when {
    state.tab == AppTab.Browse && state.librarySource == LibrarySource.Recents ->
        "Play a station and it will appear here."
    state.query.isNotBlank() || state.selectedCountry != null || state.selectedTag != null ->
        "Clear filters or try a different station, country, or tag."
    state.tab == AppTab.Favorites ->
        "Add favorites from Browse to build your station list."
    else -> "Try a station name, country code, or tag."
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

private fun stationInfoQualityLine(station: Station): String {
    val detail = buildList {
        station.codec?.trim()?.takeIf { it.isNotEmpty() }?.uppercase()?.let(::add)
        station.bitrate?.let { add("$it kbps") }
    }.joinToString(", ").ifEmpty { "Unknown codec and bitrate" }
    return "$detail, quality ${streamQualityLevel(station.codec, station.bitrate)}/4"
}

private fun stationStatusLabel(status: StationStatus): String = when (status) {
    StationStatus.Working -> "working"
    StationStatus.IcyOnly -> "icy-only"
    StationStatus.StreamOnly -> "stream-only"
}

private fun stationInfoProgramLine(playback: PlaybackUiState): String? =
    listOf(playback.programName, playback.programSubtitle)
        .mapNotNull { it?.trim()?.takeIf(String::isNotEmpty) }
        .joinToString(" / ")
        .takeIf { it.isNotEmpty() }

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
