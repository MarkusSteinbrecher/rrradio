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
import org.rrradio.android.data.CatalogLoadState
import org.rrradio.android.data.CatalogRepository
import org.rrradio.android.data.CatalogState
import org.rrradio.android.data.LibraryRepository
import org.rrradio.android.data.PlaybackUiState
import org.rrradio.android.data.PlayerState
import org.rrradio.android.data.Station
import org.rrradio.android.data.availableCountries
import org.rrradio.android.data.availableCuratedGenres
import org.rrradio.android.data.makeCustomStation
import org.rrradio.android.data.stationMatches
import org.rrradio.android.data.stationMatchesFilters
import org.rrradio.android.playback.PlaybackStateStore
import org.rrradio.android.playback.RadioPlaybackService

enum class AppTab {
    Browse,
    Library,
}

enum class LibrarySource {
    Favorites,
    Recents,
}

data class RrradioUiState(
    val catalog: CatalogState = CatalogState(),
    val favorites: List<Station> = emptyList(),
    val recents: List<Station> = emptyList(),
    val customStations: List<Station> = emptyList(),
    val playback: PlaybackUiState = PlaybackUiState(),
    val tab: AppTab = AppTab.Browse,
    val librarySource: LibrarySource = LibrarySource.Favorites,
    val query: String = "",
    val selectedCountry: String? = null,
    val selectedTag: String? = null,
    val sleepMinutes: Int = 0,
    val darkTheme: Boolean = false,
) {
    val allStations: List<Station>
        get() = customStations + catalog.browseOrdered

    val countries: List<String>
        get() = availableCountries(allStations)

    val genres: List<String>
        get() = availableCuratedGenres(allStations)

    val visibleStations: List<Station>
        get() {
            val source = when (tab) {
                AppTab.Browse -> allStations
                AppTab.Library -> when (librarySource) {
                    LibrarySource.Favorites -> favorites
                    LibrarySource.Recents -> recents
                }
            }
            val filtered = source.filter {
                stationMatches(it, query) &&
                    stationMatchesFilters(it, selectedCountry, selectedTag)
            }
            val hasQuery = query.trim().isNotEmpty()
            val hasFilters = selectedCountry != null || selectedTag != null
            val limit = if (tab == AppTab.Browse && !hasQuery && !hasFilters) 220 else filtered.size
            return filtered.take(limit)
        }

    val isCatalogEmptyLoading: Boolean
        get() = catalog.loadState in setOf(CatalogLoadState.Idle, CatalogLoadState.Loading) &&
            catalog.stations.isEmpty()
}

class RrradioViewModel(application: Application) : AndroidViewModel(application) {
    private val catalogRepository = CatalogRepository(application)
    private val libraryRepository = LibraryRepository(application)
    private var sleepJob: Job? = null

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
        _uiState.update { it.copy(tab = tab) }
    }

    fun setLibrarySource(source: LibrarySource) {
        _uiState.update { it.copy(tab = AppTab.Library, librarySource = source) }
    }

    fun setQuery(query: String) {
        _uiState.update { it.copy(query = query) }
    }

    fun setCountry(country: String?) {
        _uiState.update { it.copy(selectedCountry = country, tab = AppTab.Browse) }
    }

    fun setTag(tag: String?) {
        _uiState.update { it.copy(selectedTag = tag, tab = AppTab.Browse) }
    }

    fun toggleTheme() {
        _uiState.update { it.copy(darkTheme = !it.darkTheme) }
    }

    fun play(station: Station) {
        val context = getApplication<Application>()
        context.startService(RadioPlaybackService.playIntent(context, station))
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
                libraryRepository.addCustom(makeCustomStation(name, streamUrl, homepage, country, tags))
                onSaved()
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
        val next = cycle[(cycle.indexOf(current).takeIf { it >= 0 } ?: 0).let { (it + 1) % cycle.size }]
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

    override fun onCleared() {
        sleepJob?.cancel()
        super.onCleared()
    }
}
