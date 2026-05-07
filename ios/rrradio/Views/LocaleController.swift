import Observation
import SwiftUI

@Observable
final class LocaleController {
    enum Choice: String, CaseIterable, Identifiable {
        case system
        case english
        case german
        case french
        case spanish

        var id: String { rawValue }

        var code: String {
            switch self {
            case .system: Locale.current.language.languageCode?.identifier ?? "en"
            case .english: "en"
            case .german: "de"
            case .french: "fr"
            case .spanish: "es"
            }
        }

        var displayName: String {
            switch self {
            case .system: "System"
            case .english: "English"
            case .german: "Deutsch"
            case .french: "Français"
            case .spanish: "Español"
            }
        }

        var detail: String {
            switch self {
            case .system: "Follow iPhone language"
            case .english: "Use English"
            case .german: "Deutsch verwenden"
            case .french: "Utiliser le français"
            case .spanish: "Usar español"
            }
        }
    }

    private let defaults: UserDefaults
    private let key = "rrradio.locale"
    private(set) var choice: Choice

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        choice = defaults.string(forKey: key).flatMap(Choice.init(rawValue:)) ?? .system
    }

    var languageCode: String {
        let code = choice.code.lowercased()
        if code.hasPrefix("de") { return "de" }
        if code.hasPrefix("fr") { return "fr" }
        if code.hasPrefix("es") { return "es" }
        return "en"
    }

    func setChoice(_ newChoice: Choice) {
        choice = newChoice
        defaults.set(newChoice.rawValue, forKey: key)
    }

    func text(_ key: L10nKey) -> String {
        L10n.text(key, language: languageCode)
    }
}

enum L10nKey: String {
    case settings
    case about
    case upload
    case appPreferences
    case theme
    case system
    case followIOSAppearance
    case light
    case alwaysLight
    case dark
    case alwaysDark
    case language
    case stationView
    case listView
    case tileView
    case listViewDetail
    case tileViewDetail
    case landingPage
    case playStation
    case landingBrowseDetail
    case landingFavoritesDetail
    case landingStationDetail
    case useCurrentStation
    case selectedStation
    case chooseStation
    case searchStation
    case timerDefaults
    case defaultWake
    case defaultSleep
    case browse
    case library
    case done
    case cancel
    case close
    case checked
    case news
    case genre
    case country
    case map
    case allGenres
    case allCountries
    case goHome
    case share
    case clearSearch
    case searchAll
    case searchFavorites
    case searchRecents
    case allStations
    case favorites
    case recents
    case search
    case noStationsFound
    case catalogEmpty
    case noFavorites
    case noRecents
    case trySearch
    case catalogNoRows
    case tapHeart
    case recentsHint
    case showing
    case of
    case loading
    case loadMore
    case wake
    case sleep
    case noStation
    case unsetWakeAlarm
    case cancelSleepTimer
    case nowPlaying
    case dismissNowPlaying
    case addFavorite
    case removeFavorite
    case now
    case lyrics
    case program
    case noSchedule
    case today
    case live
    case paused
    case standby
    case playbackError
    case connecting
    case liveStream
    case play
    case pause
    case wakeToRadio
    case sleepTimer
    case collapseStreamDetails
    case expandStreamDetails
    case countryDetail
    case codec
    case bitrate
    case metadata
    case unknown
    case stream
    case wakeTime
    case unset
    case set
    case wakeHint
    case playStationFirst
    case addStation
    case saveAndPlay
}

enum L10n {
    private static let translations: [String: [L10nKey: String]] = [
        "en": [
            .settings: "Settings",
            .about: "About",
            .upload: "Add Station",
            .appPreferences: "App preferences live here.",
            .theme: "Theme",
            .system: "System",
            .followIOSAppearance: "Follow iOS appearance",
            .light: "Light",
            .alwaysLight: "Always use light mode",
            .dark: "Dark",
            .alwaysDark: "Always use dark mode",
            .language: "Language",
            .stationView: "Station view",
            .listView: "List",
            .tileView: "Tiles",
            .listViewDetail: "Show stations in rows",
            .tileViewDetail: "Show stations in a compact grid",
            .landingPage: "Landing page",
            .playStation: "Play station",
            .landingBrowseDetail: "Open the browse page on launch",
            .landingFavoritesDetail: "Open favorites on launch",
            .landingStationDetail: "Start a selected station and open Now Playing",
            .useCurrentStation: "Use current station",
            .selectedStation: "Selected",
            .chooseStation: "Choose a station",
            .searchStation: "Search station...",
            .timerDefaults: "Timer defaults",
            .defaultWake: "Default wake time",
            .defaultSleep: "Default sleep timer",
            .browse: "Browse",
            .library: "Library",
            .done: "Done",
            .cancel: "Cancel",
            .close: "Close",
            .checked: "Checked",
            .news: "News",
            .genre: "Genre",
            .country: "Country",
            .map: "Map",
            .allGenres: "All genres",
            .allCountries: "All countries",
            .goHome: "Go to home",
            .share: "Share rrradio",
            .clearSearch: "Clear search",
            .searchAll: "Search all stations...",
            .searchFavorites: "Search your favorites...",
            .searchRecents: "Search recently played...",
            .allStations: "All stations",
            .favorites: "Favorites",
            .recents: "Recents",
            .search: "Search",
            .noStationsFound: "No stations found",
            .catalogEmpty: "Catalog empty",
            .noFavorites: "No favorites yet",
            .noRecents: "No recents yet",
            .trySearch: "Try a station name, country code, or tag.",
            .catalogNoRows: "The catalog has not loaded any rows.",
            .tapHeart: "Tap the heart in Now Playing to save a station.",
            .recentsHint: "Stations appear here after you play them.",
            .showing: "Showing",
            .of: "of",
            .loading: "Loading...",
            .loadMore: "Load more",
            .wake: "Wake",
            .sleep: "Sleep",
            .noStation: "No station",
            .unsetWakeAlarm: "Unset wake alarm",
            .cancelSleepTimer: "Cancel sleep timer",
            .nowPlaying: "Now Playing",
            .dismissNowPlaying: "Dismiss now playing",
            .addFavorite: "Add to favorites",
            .removeFavorite: "Remove from favorites",
            .now: "Now",
            .lyrics: "Lyrics",
            .program: "Program",
            .noSchedule: "No schedule available",
            .today: "Today",
            .live: "Live",
            .paused: "Paused",
            .standby: "Standby",
            .playbackError: "Playback error",
            .connecting: "Connecting",
            .liveStream: "Live stream",
            .play: "Play",
            .pause: "Pause",
            .wakeToRadio: "Wake to radio",
            .sleepTimer: "Sleep timer",
            .collapseStreamDetails: "Collapse stream details",
            .expandStreamDetails: "Expand stream details",
            .countryDetail: "country",
            .codec: "codec",
            .bitrate: "bitrate",
            .metadata: "metadata",
            .unknown: "unknown",
            .stream: "stream",
            .wakeTime: "Wake time",
            .unset: "Unset",
            .set: "Set",
            .wakeHint: "Keep rrradio installed in memory for best results. iOS can show the fallback notification, but a terminated app cannot start radio playback by itself.",
            .playStationFirst: "Play a station first",
            .addStation: "Add station",
            .saveAndPlay: "Save & Play",
        ],
        "de": [
            .settings: "Einstellungen",
            .about: "Über",
            .upload: "Station hinzufügen",
            .appPreferences: "App-Einstellungen.",
            .theme: "Design",
            .system: "System",
            .followIOSAppearance: "iOS-Darstellung folgen",
            .light: "Hell",
            .alwaysLight: "Immer hell verwenden",
            .dark: "Dunkel",
            .alwaysDark: "Immer dunkel verwenden",
            .language: "Sprache",
            .stationView: "Stationsansicht",
            .listView: "Liste",
            .tileView: "Kacheln",
            .listViewDetail: "Stationen als Zeilen anzeigen",
            .tileViewDetail: "Stationen als kompaktes Raster anzeigen",
            .landingPage: "Startseite",
            .playStation: "Station starten",
            .landingBrowseDetail: "Beim Start die Suche öffnen",
            .landingFavoritesDetail: "Beim Start Favoriten öffnen",
            .landingStationDetail: "Eine gewählte Station starten und Now Playing öffnen",
            .useCurrentStation: "Aktuelle Station verwenden",
            .selectedStation: "Ausgewählt",
            .chooseStation: "Station wählen",
            .searchStation: "Station suchen...",
            .timerDefaults: "Timer-Standards",
            .defaultWake: "Standard-Weckzeit",
            .defaultSleep: "Standard-Sleep-Timer",
            .browse: "Suchen",
            .library: "Mediathek",
            .done: "Fertig",
            .cancel: "Abbrechen",
            .close: "Schließen",
            .checked: "Geprüft",
            .news: "Nachrichten",
            .genre: "Genre",
            .country: "Land",
            .map: "Karte",
            .allGenres: "Alle Genres",
            .allCountries: "Alle Länder",
            .goHome: "Zur Startseite",
            .share: "rrradio teilen",
            .clearSearch: "Suche löschen",
            .searchAll: "Alle Stationen suchen...",
            .searchFavorites: "Favoriten suchen...",
            .searchRecents: "Zuletzt gespielt suchen...",
            .allStations: "Alle Stationen",
            .favorites: "Favoriten",
            .recents: "Zuletzt",
            .search: "Suche",
            .noStationsFound: "Keine Stationen gefunden",
            .catalogEmpty: "Katalog leer",
            .noFavorites: "Noch keine Favoriten",
            .noRecents: "Noch keine zuletzt gespielten Stationen",
            .trySearch: "Versuche Stationsname, Ländercode oder Tag.",
            .catalogNoRows: "Der Katalog hat noch keine Einträge geladen.",
            .tapHeart: "Tippe in Now Playing auf das Herz, um eine Station zu speichern.",
            .recentsHint: "Stationen erscheinen hier, nachdem du sie gespielt hast.",
            .showing: "Zeige",
            .of: "von",
            .loading: "Lade...",
            .loadMore: "Mehr laden",
            .wake: "Wecken",
            .sleep: "Sleep",
            .noStation: "Keine Station",
            .unsetWakeAlarm: "Wecker deaktivieren",
            .cancelSleepTimer: "Sleep-Timer abbrechen",
            .nowPlaying: "Now Playing",
            .dismissNowPlaying: "Now Playing schliessen",
            .addFavorite: "Zu Favoriten hinzufügen",
            .removeFavorite: "Aus Favoriten entfernen",
            .now: "Jetzt",
            .lyrics: "Lyrics",
            .program: "Programm",
            .noSchedule: "Kein Programm verfügbar",
            .today: "Heute",
            .live: "Live",
            .paused: "Pausiert",
            .standby: "Bereit",
            .playbackError: "Wiedergabefehler",
            .connecting: "Verbinde",
            .liveStream: "Livestream",
            .play: "Play",
            .pause: "Pause",
            .wakeToRadio: "Mit Radio wecken",
            .sleepTimer: "Sleep-Timer",
            .collapseStreamDetails: "Streamdetails einklappen",
            .expandStreamDetails: "Streamdetails ausklappen",
            .countryDetail: "land",
            .codec: "codec",
            .bitrate: "bitrate",
            .metadata: "metadaten",
            .unknown: "unbekannt",
            .stream: "stream",
            .wakeTime: "Weckzeit",
            .unset: "Aus",
            .set: "Setzen",
            .wakeHint: "Lass rrradio für beste Ergebnisse im Speicher. iOS kann die Ersatz-Benachrichtigung zeigen, aber eine beendete App kann Radio nicht selbst starten.",
            .playStationFirst: "Erst eine Station abspielen",
            .addStation: "Station hinzufügen",
            .saveAndPlay: "Speichern & abspielen",
        ],
        "fr": [
            .settings: "Réglages",
            .about: "À propos",
            .upload: "Ajouter une station",
            .appPreferences: "Préférences de l'app.",
            .theme: "Apparence",
            .system: "Système",
            .followIOSAppearance: "Suivre l'apparence iOS",
            .light: "Clair",
            .alwaysLight: "Toujours utiliser le mode clair",
            .dark: "Sombre",
            .alwaysDark: "Toujours utiliser le mode sombre",
            .language: "Langue",
            .stationView: "Affichage des stations",
            .listView: "Liste",
            .tileView: "Tuiles",
            .listViewDetail: "Afficher les stations en lignes",
            .tileViewDetail: "Afficher les stations en grille compacte",
            .landingPage: "Page d'accueil",
            .playStation: "Lire une station",
            .landingBrowseDetail: "Ouvrir la page Parcourir au lancement",
            .landingFavoritesDetail: "Ouvrir les favoris au lancement",
            .landingStationDetail: "Lancer une station choisie et ouvrir En lecture",
            .useCurrentStation: "Utiliser la station actuelle",
            .selectedStation: "Sélection",
            .chooseStation: "Choisir une station",
            .searchStation: "Rechercher une station...",
            .timerDefaults: "Réglages des minuteurs",
            .defaultWake: "Heure de réveil par défaut",
            .defaultSleep: "Minuterie sommeil par défaut",
            .browse: "Parcourir",
            .library: "Bibliothèque",
            .done: "OK",
            .cancel: "Annuler",
            .close: "Fermer",
            .checked: "Vérifiées",
            .news: "Infos",
            .genre: "Genre",
            .country: "Pays",
            .map: "Carte",
            .allGenres: "Tous les genres",
            .allCountries: "Tous les pays",
            .goHome: "Accueil",
            .share: "Partager rrradio",
            .clearSearch: "Effacer la recherche",
            .searchAll: "Rechercher des stations...",
            .searchFavorites: "Rechercher dans les favoris...",
            .searchRecents: "Rechercher les écoutes récentes...",
            .allStations: "Toutes les stations",
            .favorites: "Favoris",
            .recents: "Récents",
            .search: "Recherche",
            .noStationsFound: "Aucune station trouvée",
            .catalogEmpty: "Catalogue vide",
            .noFavorites: "Aucun favori",
            .noRecents: "Aucune écoute récente",
            .trySearch: "Essayez un nom de station, un code pays ou un tag.",
            .catalogNoRows: "Le catalogue n'a chargé aucune ligne.",
            .tapHeart: "Touchez le cœur dans Now Playing pour enregistrer une station.",
            .recentsHint: "Les stations apparaissent ici après écoute.",
            .showing: "Affiche",
            .of: "sur",
            .loading: "Chargement...",
            .loadMore: "Charger plus",
            .wake: "Réveil",
            .sleep: "Sommeil",
            .noStation: "Aucune station",
            .unsetWakeAlarm: "Désactiver le réveil",
            .cancelSleepTimer: "Annuler la minuterie",
            .nowPlaying: "En lecture",
            .dismissNowPlaying: "Fermer la lecture",
            .addFavorite: "Ajouter aux favoris",
            .removeFavorite: "Retirer des favoris",
            .now: "Maintenant",
            .lyrics: "Paroles",
            .program: "Programme",
            .noSchedule: "Aucun programme disponible",
            .today: "Aujourd'hui",
            .live: "Live",
            .paused: "Pause",
            .standby: "Veille",
            .playbackError: "Erreur de lecture",
            .connecting: "Connexion",
            .liveStream: "Flux live",
            .play: "Lire",
            .pause: "Pause",
            .wakeToRadio: "Réveil radio",
            .sleepTimer: "Minuterie sommeil",
            .collapseStreamDetails: "Masquer les détails du flux",
            .expandStreamDetails: "Afficher les détails du flux",
            .countryDetail: "pays",
            .codec: "codec",
            .bitrate: "débit",
            .metadata: "métadonnées",
            .unknown: "inconnu",
            .stream: "flux",
            .wakeTime: "Heure du réveil",
            .unset: "Retirer",
            .set: "Définir",
            .wakeHint: "Gardez rrradio en mémoire pour de meilleurs résultats. iOS peut afficher la notification de secours, mais une app fermée ne peut pas lancer la radio seule.",
            .playStationFirst: "Lancez d'abord une station",
            .addStation: "Ajouter une station",
            .saveAndPlay: "Enregistrer et lire",
        ],
        "es": [
            .settings: "Ajustes",
            .about: "Acerca de",
            .upload: "Añadir emisora",
            .appPreferences: "Preferencias de la app.",
            .theme: "Tema",
            .system: "Sistema",
            .followIOSAppearance: "Seguir apariencia de iOS",
            .light: "Claro",
            .alwaysLight: "Usar siempre modo claro",
            .dark: "Oscuro",
            .alwaysDark: "Usar siempre modo oscuro",
            .language: "Idioma",
            .stationView: "Vista de emisoras",
            .listView: "Lista",
            .tileView: "Mosaicos",
            .listViewDetail: "Mostrar emisoras en filas",
            .tileViewDetail: "Mostrar emisoras en una cuadrícula compacta",
            .landingPage: "Página inicial",
            .playStation: "Reproducir emisora",
            .landingBrowseDetail: "Abrir Explorar al iniciar",
            .landingFavoritesDetail: "Abrir Favoritos al iniciar",
            .landingStationDetail: "Iniciar una emisora elegida y abrir Reproduciendo",
            .useCurrentStation: "Usar emisora actual",
            .selectedStation: "Seleccionada",
            .chooseStation: "Elegir emisora",
            .searchStation: "Buscar emisora...",
            .timerDefaults: "Temporizadores predeterminados",
            .defaultWake: "Hora de alarma predeterminada",
            .defaultSleep: "Temporizador predeterminado",
            .browse: "Explorar",
            .library: "Biblioteca",
            .done: "Listo",
            .cancel: "Cancelar",
            .close: "Cerrar",
            .checked: "Revisadas",
            .news: "Noticias",
            .genre: "Género",
            .country: "País",
            .map: "Mapa",
            .allGenres: "Todos los géneros",
            .allCountries: "Todos los países",
            .goHome: "Ir al inicio",
            .share: "Compartir rrradio",
            .clearSearch: "Borrar búsqueda",
            .searchAll: "Buscar emisoras...",
            .searchFavorites: "Buscar favoritos...",
            .searchRecents: "Buscar recientes...",
            .allStations: "Todas las emisoras",
            .favorites: "Favoritos",
            .recents: "Recientes",
            .search: "Búsqueda",
            .noStationsFound: "No se encontraron emisoras",
            .catalogEmpty: "Catálogo vacío",
            .noFavorites: "Aun no hay favoritos",
            .noRecents: "Aun no hay recientes",
            .trySearch: "Prueba con nombre, código de país o etiqueta.",
            .catalogNoRows: "El catálogo no ha cargado filas.",
            .tapHeart: "Toca el corazón en Now Playing para guardar una emisora.",
            .recentsHint: "Las emisoras aparecen aquí después de escucharlas.",
            .showing: "Mostrando",
            .of: "de",
            .loading: "Cargando...",
            .loadMore: "Cargar mas",
            .wake: "Despertar",
            .sleep: "Dormir",
            .noStation: "Sin emisora",
            .unsetWakeAlarm: "Quitar alarma",
            .cancelSleepTimer: "Cancelar temporizador",
            .nowPlaying: "Reproduciendo",
            .dismissNowPlaying: "Cerrar reproducción",
            .addFavorite: "Añadir a favoritos",
            .removeFavorite: "Quitar de favoritos",
            .now: "Ahora",
            .lyrics: "Letra",
            .program: "Programa",
            .noSchedule: "No hay programación disponible",
            .today: "Hoy",
            .live: "En vivo",
            .paused: "Pausado",
            .standby: "En espera",
            .playbackError: "Error de reproducción",
            .connecting: "Conectando",
            .liveStream: "Stream en vivo",
            .play: "Reproducir",
            .pause: "Pausar",
            .wakeToRadio: "Despertar con radio",
            .sleepTimer: "Temporizador",
            .collapseStreamDetails: "Ocultar detalles del stream",
            .expandStreamDetails: "Mostrar detalles del stream",
            .countryDetail: "país",
            .codec: "codec",
            .bitrate: "bitrate",
            .metadata: "metadatos",
            .unknown: "desconocido",
            .stream: "stream",
            .wakeTime: "Hora de alarma",
            .unset: "Quitar",
            .set: "Activar",
            .wakeHint: "Mantenga rrradio en memoria para mejores resultados. iOS puede mostrar la notificación de respaldo, pero una app cerrada no puede iniciar la radio sola.",
            .playStationFirst: "Reproduce una emisora primero",
            .addStation: "Añadir emisora",
            .saveAndPlay: "Guardar y reproducir",
        ],
    ]

    static func text(_ key: L10nKey, language: String) -> String {
        translations[language]?[key] ?? translations["en"]?[key] ?? key.rawValue
    }
}
