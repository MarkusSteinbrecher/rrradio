package org.rrradio.android.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.rrradio.android.data.AccentPreference
import org.rrradio.android.data.AppThemePreference
import org.rrradio.android.data.BrowseStationSort
import org.rrradio.android.data.CatalogLoadState
import org.rrradio.android.data.CatalogRepository
import org.rrradio.android.data.CatalogState
import org.rrradio.android.data.LandingPagePreference
import org.rrradio.android.data.LibraryRepository
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.Station
import org.rrradio.android.data.StationList
import org.rrradio.android.data.StreamProbe
import org.rrradio.android.data.StreamProbeResult
import org.rrradio.android.data.availableCountries
import org.rrradio.android.data.availableCuratedGenres
import org.rrradio.android.data.makeCustomStation
import org.rrradio.android.playback.activePlaybackQueue
import org.rrradio.android.data.stationMatches
import org.rrradio.android.data.stationMatchesFilters
import org.rrradio.android.data.sortedBrowseStations
import org.rrradio.android.playback.PlaybackStateStore
import org.rrradio.android.playback.RadioPlaybackService

enum class AppTab {
    StationLists,
    Browse,
    Favorites,
}

enum class LibrarySource {
    Favorites,
    Recents,
}

enum class FavoritesDisplayMode {
    List,
    Tiles,
    App,
}

data class RrradioUiState(
    val catalog: CatalogState = CatalogState(),
    val favorites: List<Station> = emptyList(),
    val recents: List<Station> = emptyList(),
    val customStations: List<Station> = emptyList(),
    val stationLists: List<StationList> = emptyList(),
    val playback: PlaybackUiState = PlaybackUiState(),
    val tab: AppTab = AppTab.Browse,
    val librarySource: LibrarySource = LibrarySource.Favorites,
    val selectedStationListId: String? = null,
    val stationSelectionActive: Boolean = false,
    val selectedStationIds: Set<String> = emptySet(),
    val query: String = "",
    val selectedCountry: String? = null,
    val selectedTag: String? = null,
    val browseStationSort: BrowseStationSort? = null,
    val sleepMinutes: Int = 0,
    val sleepDefaultMinutes: Int = LibraryRepository.DEFAULT_SLEEP_MINUTES,
    val themePreference: AppThemePreference = AppThemePreference.System,
    val accentPreference: AccentPreference = AccentPreference.Classic,
    val landingPagePreference: LandingPagePreference = LandingPagePreference.Browse,
    val favoritesDisplayMode: FavoritesDisplayMode = FavoritesDisplayMode.List,
) {
    val allStations: List<Station>
        get() = customStations + catalog.browseOrdered

    val selectedStationList: StationList?
        get() = stationLists.firstOrNull { it.id == selectedStationListId }

    val selectedStations: List<Station>
        get() = allStations.filter { it.id in selectedStationIds }

    val countries: List<String>
        get() = availableCountries(allStations)

    val genres: List<String>
        get() = availableCuratedGenres(allStations)

    val visibleStations: List<Station>
        get() {
            val source = when (tab) {
                AppTab.StationLists -> selectedStationList?.stations.orEmpty()
                AppTab.Browse -> when (librarySource) {
                    LibrarySource.Favorites -> allStations
                    LibrarySource.Recents -> recents
                }
                AppTab.Favorites -> favorites
            }
            val filtered = source.filter {
                stationMatches(it, query) &&
                    stationMatchesFilters(it, selectedCountry, selectedTag)
            }
            val sorted = if (tab == AppTab.Browse && librarySource == LibrarySource.Favorites) {
                sortedBrowseStations(
                    stations = filtered,
                    sort = browseStationSort,
                    favoriteIds = favorites.mapTo(mutableSetOf()) { it.id },
                )
            } else {
                filtered
            }
            val hasQuery = query.trim().isNotEmpty()
            val hasFilters = selectedCountry != null || selectedTag != null
            val limit = if (tab == AppTab.Browse && !hasQuery && !hasFilters && browseStationSort == null) 220 else sorted.size
            return sorted.take(limit)
        }

    val isCatalogEmptyLoading: Boolean
        get() = catalog.loadState in setOf(CatalogLoadState.Idle, CatalogLoadState.Loading) &&
            catalog.stations.isEmpty()
}

class RrradioViewModel(application: Application) : AndroidViewModel(application) {
    private val catalogRepository = CatalogRepository(application)
    private val libraryRepository = LibraryRepository(application)
    private val streamProbe = StreamProbe()
    private var sleepJob: Job? = null
    private var appliedLandingPagePreference = false

    private val _uiState = MutableStateFlow(RrradioUiState())
    val uiState: StateFlow<RrradioUiState> = _uiState.asStateFlow()

    init {
        refreshCatalog()
        viewModelScope.launch {
            libraryRepository.favorites.collect { favorites ->
                _uiState.update { it.copy(favorites = favorites) }
            }
        }
        viewModelScope.launch {
            libraryRepository.recents.collect { recents ->
                _uiState.update { it.copy(recents = recents) }
            }
        }
        viewModelScope.launch {
            libraryRepository.customStations.collect { custom ->
                _uiState.update { it.copy(customStations = custom) }
            }
        }
        viewModelScope.launch {
            libraryRepository.stationLists.collect { stationLists ->
                _uiState.update { state ->
                    val selectedId = state.selectedStationListId?.takeIf { id -> stationLists.any { it.id == id } }
                    state.copy(stationLists = stationLists, selectedStationListId = selectedId)
                }
            }
        }
        viewModelScope.launch {
            libraryRepository.themePreference.collect { preference ->
                _uiState.update { it.copy(themePreference = preference) }
            }
        }
        viewModelScope.launch {
            libraryRepository.accentPreference.collect { preference ->
                _uiState.update { it.copy(accentPreference = preference) }
            }
        }
        viewModelScope.launch {
            libraryRepository.landingPagePreference.collect { preference ->
                _uiState.update { state ->
                    val startupTab = if (!appliedLandingPagePreference) landingTab(preference) else state.tab
                    state.copy(landingPagePreference = preference, tab = startupTab)
                }
                appliedLandingPagePreference = true
            }
        }
        viewModelScope.launch {
            libraryRepository.sleepDefaultMinutes.collect { minutes ->
                _uiState.update { it.copy(sleepDefaultMinutes = minutes) }
            }
        }
        viewModelScope.launch {
            PlaybackStateStore.state.collect { playback ->
                _uiState.update { it.copy(playback = playback) }
            }
        }
    }

    fun refreshCatalog() {
        viewModelScope.launch {
            _uiState.update { it.copy(catalog = it.catalog.copy(loadState = CatalogLoadState.Loading)) }
            val cached = catalogRepository.readCache()
            if (cached.isNotEmpty()) {
                _uiState.update {
                    it.copy(catalog = CatalogState(stations = cached, loadState = CatalogLoadState.Loaded))
                }
            }
            _uiState.update { it.copy(catalog = catalogRepository.load()) }
        }
    }

    fun setTab(tab: AppTab) {
        _uiState.update {
            it.copy(
                tab = tab,
                stationSelectionActive = false,
                selectedStationIds = emptySet(),
            )
        }
    }

    fun setLibrarySource(source: LibrarySource) {
        _uiState.update {
            it.copy(
                tab = AppTab.Browse,
                librarySource = source,
                browseStationSort = if (source == LibrarySource.Recents) null else it.browseStationSort,
            )
        }
    }

    fun setQuery(query: String) {
        _uiState.update { it.copy(query = query) }
    }

    fun beginStationSelection() {
        _uiState.update {
            it.copy(
                tab = AppTab.Browse,
                librarySource = LibrarySource.Favorites,
                stationSelectionActive = true,
                selectedStationIds = emptySet(),
            )
        }
    }

    fun cancelStationSelection() {
        _uiState.update { it.copy(stationSelectionActive = false, selectedStationIds = emptySet()) }
    }

    fun toggleStationSelection(station: Station) {
        _uiState.update { state ->
            val next = state.selectedStationIds.toMutableSet()
            if (!next.add(station.id)) next.remove(station.id)
            state.copy(selectedStationIds = next)
        }
    }

    fun setCountry(country: String?) {
        _uiState.update { it.copy(selectedCountry = country, tab = AppTab.Browse, librarySource = LibrarySource.Favorites) }
    }

    fun setTag(tag: String?) {
        _uiState.update { it.copy(selectedTag = tag, tab = AppTab.Browse, librarySource = LibrarySource.Favorites) }
    }

    fun cycleAlphabetSort() {
        _uiState.update {
            it.copy(
                tab = AppTab.Browse,
                librarySource = LibrarySource.Favorites,
                browseStationSort = when (it.browseStationSort) {
                    BrowseStationSort.AlphabetAscending -> BrowseStationSort.AlphabetDescending
                    BrowseStationSort.AlphabetDescending -> null
                    else -> BrowseStationSort.AlphabetAscending
                },
            )
        }
    }

    fun cycleQualitySort() {
        _uiState.update {
            it.copy(
                tab = AppTab.Browse,
                librarySource = LibrarySource.Favorites,
                browseStationSort = when (it.browseStationSort) {
                    BrowseStationSort.QualityLow -> BrowseStationSort.QualityHigh
                    BrowseStationSort.QualityHigh -> null
                    else -> BrowseStationSort.QualityLow
                },
            )
        }
    }

    fun cycleFavoriteSort() {
        _uiState.update {
            it.copy(
                tab = AppTab.Browse,
                librarySource = LibrarySource.Favorites,
                browseStationSort = when (it.browseStationSort) {
                    BrowseStationSort.FavoritesFirst -> BrowseStationSort.FavoritesLast
                    BrowseStationSort.FavoritesLast -> null
                    else -> BrowseStationSort.FavoritesFirst
                },
            )
        }
    }

    fun setFavoritesDisplayMode(mode: FavoritesDisplayMode) {
        _uiState.update { it.copy(favoritesDisplayMode = mode, tab = AppTab.Favorites) }
    }

    fun openStationList(listId: String) {
        _uiState.update { it.copy(tab = AppTab.StationLists, selectedStationListId = listId) }
    }

    fun closeStationList() {
        _uiState.update { it.copy(tab = AppTab.StationLists, selectedStationListId = null) }
    }

    fun createStationList(name: String, includeSelectedStations: Boolean = false) {
        viewModelScope.launch {
            val stations = if (includeSelectedStations) uiState.value.selectedStations else emptyList()
            val list = libraryRepository.createStationList(name, stations)
            _uiState.update {
                it.copy(
                    tab = AppTab.StationLists,
                    selectedStationListId = list.id,
                    stationSelectionActive = false,
                    selectedStationIds = emptySet(),
                )
            }
        }
    }

    fun removeStationList(listId: String) {
        viewModelScope.launch {
            libraryRepository.removeStationList(listId)
            _uiState.update { it.copy(tab = AppTab.StationLists, selectedStationListId = null) }
        }
    }

    fun renameStationList(listId: String, name: String) {
        viewModelScope.launch { libraryRepository.renameStationList(listId, name) }
    }

    fun saveSelectedStationsToList(listId: String) {
        val stations = uiState.value.selectedStations
        viewModelScope.launch {
            libraryRepository.addStationsToList(listId, stations)
            _uiState.update {
                it.copy(
                    tab = AppTab.StationLists,
                    selectedStationListId = listId,
                    stationSelectionActive = false,
                    selectedStationIds = emptySet(),
                )
            }
        }
    }

    fun removeStationFromSelectedList(station: Station) {
        val listId = uiState.value.selectedStationListId ?: return
        viewModelScope.launch { libraryRepository.removeStationFromList(listId, station.id) }
    }

    fun moveFavorite(station: Station, offset: Int) {
        val favorites = uiState.value.favorites
        val index = favorites.indexOfFirst { it.id == station.id }
        val target = index + offset
        if (index < 0 || target !in favorites.indices) return
        val mutable = favorites.toMutableList()
        val moved = mutable.removeAt(index)
        mutable.add(target, moved)
        viewModelScope.launch { libraryRepository.reorderFavorites(mutable.map { it.id }) }
    }

    fun moveStationList(list: StationList, offset: Int) {
        val lists = uiState.value.stationLists
        val index = lists.indexOfFirst { it.id == list.id }
        val target = index + offset
        if (index < 0 || target !in lists.indices) return
        val mutable = lists.toMutableList()
        val moved = mutable.removeAt(index)
        mutable.add(target, moved)
        viewModelScope.launch { libraryRepository.reorderStationLists(mutable.map { it.id }) }
    }

    fun moveStationInSelectedList(station: Station, offset: Int) {
        val list = uiState.value.selectedStationList ?: return
        val index = list.stations.indexOfFirst { it.id == station.id }
        val target = index + offset
        if (index < 0 || target !in list.stations.indices) return
        val mutable = list.stations.toMutableList()
        val moved = mutable.removeAt(index)
        mutable.add(target, moved)
        viewModelScope.launch { libraryRepository.reorderStationsInList(list.id, mutable.map { it.id }) }
    }

    fun setThemePreference(preference: AppThemePreference) {
        viewModelScope.launch { libraryRepository.setThemePreference(preference) }
    }

    fun setAccentPreference(preference: AccentPreference) {
        viewModelScope.launch { libraryRepository.setAccentPreference(preference) }
    }

    fun setLandingPagePreference(preference: LandingPagePreference) {
        viewModelScope.launch { libraryRepository.setLandingPagePreference(preference) }
    }

    fun setSleepDefaultMinutes(minutes: Int) {
        viewModelScope.launch { libraryRepository.setSleepDefaultMinutes(minutes) }
    }

    fun play(station: Station) {
        val context = getApplication<Application>()
        val queue = activePlaybackQueue(uiState.value.visibleStations, station)
        context.startService(RadioPlaybackService.playIntent(context, station, queue))
        viewModelScope.launch { libraryRepository.pushRecent(station) }
    }

    fun togglePlayback() {
        val context = getApplication<Application>()
        context.startService(RadioPlaybackService.toggleIntent(context))
    }

    fun toggleFavorite(station: Station) {
        viewModelScope.launch { libraryRepository.toggleFavorite(station) }
    }

    fun addCustom(
        name: String,
        streamUrl: String,
        homepage: String,
        country: String,
        tags: String,
        onError: (String) -> Unit,
        onSaved: () -> Unit,
    ) {
        viewModelScope.launch {
            try {
                val station = makeCustomStation(
                    name = name,
                    streamUrl = streamUrl,
                    homepage = homepage,
                    country = country,
                    tags = tags,
                    existingStations = uiState.value.allStations,
                )
                when (val result = streamProbe.verify(station.streamUrl)) {
                    StreamProbeResult.Playable -> {
                        libraryRepository.addCustom(station)
                        libraryRepository.addFavorite(station)
                        onSaved()
                    }
                    is StreamProbeResult.Failed -> onError(result.message)
                }
            } catch (error: IllegalArgumentException) {
                onError(error.message ?: "Invalid station")
            }
        }
    }

    fun removeCustom(station: Station) {
        viewModelScope.launch { libraryRepository.removeCustom(station.id) }
    }

    fun cycleSleepTimer() {
        val cycle = listOf(0, 15, 30, 60, 90)
        val current = uiState.value.sleepMinutes
        val default = uiState.value.sleepDefaultMinutes
        val next = if (current == 0) {
            default
        } else {
            cycle[(cycle.indexOf(current).takeIf { it >= 0 } ?: 0).let { (it + 1) % cycle.size }]
        }
        sleepJob?.cancel()
        if (next == 0) {
            _uiState.update { it.copy(sleepMinutes = 0) }
            return
        }
        _uiState.update { it.copy(sleepMinutes = next) }
        sleepJob = viewModelScope.launch {
            delay(next * 60_000L)
            val context = getApplication<Application>()
            context.startService(RadioPlaybackService.pauseIntent(context))
            _uiState.update { it.copy(sleepMinutes = 0) }
        }
    }

    private fun landingTab(preference: LandingPagePreference): AppTab = when (preference) {
        LandingPagePreference.StationLists -> AppTab.StationLists
        LandingPagePreference.Browse -> AppTab.Browse
        LandingPagePreference.Favorites -> AppTab.Favorites
    }

    override fun onCleared() {
        sleepJob?.cancel()
        super.onCleared()
    }
}
