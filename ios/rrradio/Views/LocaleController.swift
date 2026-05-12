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
    @ObservationIgnored var onChange: (() -> Void)?

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
        onChange?()
    }

    func applyCloudSync(_ newChoice: Choice) {
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
    case carMode
    case automaticCarMode
    case manualCarMode
    case currentAudioRoute
    case carModeActive
    case carModeInactive
    case browse
    case library
    case done
    case cancel
    case close
    case ok
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
    case searchCustomStations
    case searchRecents
    case searchCountries
    case allStations
    case favorites
    case customStations
    case recents
    case search
    case noStationsFound
    case noFavoriteSearchResultsShowingCatalog
    case catalogEmpty
    case noFavorites
    case noCustomStations
    case noRecents
    case trySearch
    case catalogNoRows
    case tapHeart
    case customStationsHint
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
    case format
    case genres
    case metadata
    case unknown
    case website
    case open
    case stream
    case wakeTime
    case unset
    case set
    case wakeHint
    case wakeNotificationsDeniedWarning
    case openSettings
    case wakePauseWarningTitle
    case wakePauseWarningMessage
    case dontShowAgain
    case setupScheduledPlay
    case setupScheduledPlayDetail
    case wakeKeepAlive
    case wakeKeepAliveDetail
    case playStationFirst
    case addStation
    case saveAnyway
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
            .carMode: "Car Mode",
            .automaticCarMode: "Automatic Car Mode",
            .manualCarMode: "Manual Car Mode",
            .currentAudioRoute: "Current audio route",
            .carModeActive: "Large Now Playing controls are active",
            .carModeInactive: "Use this to force Car Mode",
            .browse: "Browse",
            .library: "Library",
            .done: "Done",
            .cancel: "Cancel",
            .close: "Close",
            .ok: "OK",
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
            .searchCustomStations: "Search your stations...",
            .searchRecents: "Search recently played...",
            .searchCountries: "Search countries...",
            .allStations: "All stations",
            .favorites: "Favorites",
            .customStations: "My stations",
            .recents: "Recents",
            .search: "Search",
            .noStationsFound: "No stations found",
            .noFavoriteSearchResultsShowingCatalog: "No results found in your favorites.\nShowing results from the catalog.",
            .catalogEmpty: "Catalog empty",
            .noFavorites: "No favorites yet",
            .noCustomStations: "No custom stations yet",
            .noRecents: "No recents yet",
            .trySearch: "Try a station name, country code, or tag.",
            .catalogNoRows: "The catalog has not loaded any rows.",
            .tapHeart: "Tap the heart in Now Playing to save a station.",
            .customStationsHint: "Tap the plus button to add your own stream.",
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
            .format: "format",
            .genres: "genres",
            .metadata: "metadata",
            .unknown: "unknown",
            .website: "website",
            .open: "open",
            .stream: "stream",
            .wakeTime: "Wake time",
            .unset: "Unset",
            .set: "Set",
            .wakeHint: "For the best chance of autoplay, keep rrradio running and enable the audio keep-alive option.",
            .wakeNotificationsDeniedWarning: "Notifications are off. Wake alarm cannot reliably fire - your phone may stay asleep at the set time.",
            .openSettings: "Open Settings",
            .wakePauseWarningTitle: "Wake alarm may not auto-play",
            .wakePauseWarningMessage: "You paused playback. iOS may suspend rrradio before your alarm.\n\nThe alarm will still fire as a notification you can tap - but it cannot auto-start the radio.\n\nTo auto-play, keep the radio playing through the wake time, or set up a Shortcuts Personal Automation.",
            .dontShowAgain: "Don't show again",
            .setupScheduledPlay: "Set up scheduled play",
            .setupScheduledPlayDetail: "Opens Shortcuts for scheduled play. iOS may require the phone to be unlocked.",
            .wakeKeepAlive: "Keep audio alive until wake",
            .wakeKeepAliveDetail: "Plays a near-silent local sound so iOS is less likely to suspend rrradio before the wake time. This uses battery and only works while the app remains installed and running.",
            .playStationFirst: "Play a station first",
            .addStation: "Add station",
            .saveAnyway: "Save anyway",
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
            .carMode: "Auto-Modus",
            .automaticCarMode: "Auto-Modus automatisch",
            .manualCarMode: "Auto-Modus manuell",
            .currentAudioRoute: "Aktuelle Audio-Ausgabe",
            .carModeActive: "Große Now-Playing-Bedienung ist aktiv",
            .carModeInactive: "Aktiviere den Auto-Modus manuell",
            .browse: "Suchen",
            .library: "Mediathek",
            .done: "Fertig",
            .cancel: "Abbrechen",
            .close: "Schließen",
            .ok: "OK",
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
            .searchCustomStations: "Eigene Stationen suchen...",
            .searchRecents: "Zuletzt gespielt suchen...",
            .searchCountries: "Länder suchen...",
            .allStations: "Alle Stationen",
            .favorites: "Favoriten",
            .customStations: "Eigene",
            .recents: "Zuletzt",
            .search: "Suche",
            .noStationsFound: "Keine Stationen gefunden",
            .noFavoriteSearchResultsShowingCatalog: "No results found in your favorites.\nShowing results from the catalog.",
            .catalogEmpty: "Katalog leer",
            .noFavorites: "Noch keine Favoriten",
            .noCustomStations: "Noch keine eigenen Stationen",
            .noRecents: "Noch keine zuletzt gespielten Stationen",
            .trySearch: "Versuche Stationsname, Ländercode oder Tag.",
            .catalogNoRows: "Der Katalog hat noch keine Einträge geladen.",
            .tapHeart: "Tippe in Now Playing auf das Herz, um eine Station zu speichern.",
            .customStationsHint: "Tippe auf Plus, um einen eigenen Stream hinzuzufügen.",
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
            .format: "format",
            .genres: "genres",
            .metadata: "metadaten",
            .unknown: "unbekannt",
            .website: "website",
            .open: "öffnen",
            .stream: "stream",
            .wakeTime: "Weckzeit",
            .unset: "Aus",
            .set: "Setzen",
            .wakeHint: "Für die beste Autoplay-Chance lass rrradio laufen und aktiviere die Audio-Keep-Alive-Option.",
            .wakeNotificationsDeniedWarning: "Mitteilungen sind aus. Der Wecker kann nicht zuverlässig auslösen - dein iPhone bleibt zur Weckzeit eventuell im Ruhezustand.",
            .openSettings: "Einstellungen öffnen",
            .wakePauseWarningTitle: "Wecker spielt eventuell nicht automatisch",
            .wakePauseWarningMessage: "Du hast die Wiedergabe pausiert. iOS kann rrradio vor dem Wecker anhalten.\n\nDer Wecker erscheint weiterhin als Mitteilung, die du antippen kannst - aber er kann das Radio nicht automatisch starten.\n\nFür Autoplay lass das Radio bis zur Weckzeit laufen oder richte eine Kurzbefehle-Automation ein.",
            .dontShowAgain: "Nicht mehr zeigen",
            .setupScheduledPlay: "Geplante Wiedergabe einrichten",
            .setupScheduledPlayDetail: "Öffnet Kurzbefehle für geplante Wiedergabe. iOS kann verlangen, dass das iPhone entsperrt ist.",
            .wakeKeepAlive: "Audio bis zum Wecken aktiv halten",
            .wakeKeepAliveDetail: "Spielt einen fast lautlosen lokalen Ton, damit iOS rrradio vor der Weckzeit weniger wahrscheinlich anhält. Das verbraucht Akku und funktioniert nur, solange die App läuft.",
            .playStationFirst: "Erst eine Station abspielen",
            .addStation: "Station hinzufügen",
            .saveAnyway: "Trotzdem speichern",
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
            .carMode: "Mode voiture",
            .automaticCarMode: "Mode voiture automatique",
            .manualCarMode: "Mode voiture manuel",
            .currentAudioRoute: "Sortie audio actuelle",
            .carModeActive: "Les grands contrôles de lecture sont actifs",
            .carModeInactive: "Activer le mode voiture manuellement",
            .browse: "Parcourir",
            .library: "Bibliothèque",
            .done: "OK",
            .cancel: "Annuler",
            .close: "Fermer",
            .ok: "OK",
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
            .searchCustomStations: "Rechercher vos stations...",
            .searchRecents: "Rechercher les écoutes récentes...",
            .searchCountries: "Rechercher les pays...",
            .allStations: "Toutes les stations",
            .favorites: "Favoris",
            .customStations: "Mes stations",
            .recents: "Récents",
            .search: "Recherche",
            .noStationsFound: "Aucune station trouvée",
            .noFavoriteSearchResultsShowingCatalog: "No results found in your favorites.\nShowing results from the catalog.",
            .catalogEmpty: "Catalogue vide",
            .noFavorites: "Aucun favori",
            .noCustomStations: "Aucune station personnelle",
            .noRecents: "Aucune écoute récente",
            .trySearch: "Essayez un nom de station, un code pays ou un tag.",
            .catalogNoRows: "Le catalogue n'a chargé aucune ligne.",
            .tapHeart: "Touchez le cœur dans Now Playing pour enregistrer une station.",
            .customStationsHint: "Touchez le bouton plus pour ajouter votre propre flux.",
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
            .format: "format",
            .genres: "genres",
            .metadata: "métadonnées",
            .unknown: "inconnu",
            .website: "site web",
            .open: "ouvrir",
            .stream: "flux",
            .wakeTime: "Heure du réveil",
            .unset: "Retirer",
            .set: "Définir",
            .wakeHint: "Pour maximiser les chances de lecture automatique, gardez rrradio ouvert et activez l'option audio keep-alive.",
            .wakeNotificationsDeniedWarning: "Les notifications sont désactivées. Le réveil ne peut pas se déclencher de façon fiable - votre iPhone peut rester en veille.",
            .openSettings: "Ouvrir Réglages",
            .wakePauseWarningTitle: "Le réveil peut ne pas lancer la lecture",
            .wakePauseWarningMessage: "Vous avez mis la lecture en pause. iOS peut suspendre rrradio avant le réveil.\n\nLe réveil s'affichera quand même comme notification à toucher - mais il ne peut pas lancer la radio automatiquement.\n\nPour la lecture automatique, gardez la radio active jusqu'à l'heure du réveil ou configurez une automatisation Raccourcis.",
            .dontShowAgain: "Ne plus afficher",
            .setupScheduledPlay: "Configurer la lecture planifiée",
            .setupScheduledPlayDetail: "Ouvre Raccourcis pour une lecture planifiée. iOS peut exiger que l'iPhone soit déverrouillé.",
            .wakeKeepAlive: "Garder l'audio actif jusqu'au réveil",
            .wakeKeepAliveDetail: "Lit un son local presque silencieux pour qu'iOS suspende moins probablement rrradio avant l'heure du réveil. Cela consomme de la batterie et fonctionne seulement si l'app reste ouverte.",
            .playStationFirst: "Lancez d'abord une station",
            .addStation: "Ajouter une station",
            .saveAnyway: "Enregistrer quand meme",
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
            .carMode: "Modo coche",
            .automaticCarMode: "Modo coche automático",
            .manualCarMode: "Modo coche manual",
            .currentAudioRoute: "Salida de audio actual",
            .carModeActive: "Los controles grandes están activos",
            .carModeInactive: "Activa el modo coche manualmente",
            .browse: "Explorar",
            .library: "Biblioteca",
            .done: "Listo",
            .cancel: "Cancelar",
            .close: "Cerrar",
            .ok: "OK",
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
            .searchCustomStations: "Buscar tus emisoras...",
            .searchRecents: "Buscar recientes...",
            .searchCountries: "Buscar países...",
            .allStations: "Todas las emisoras",
            .favorites: "Favoritos",
            .customStations: "Mis emisoras",
            .recents: "Recientes",
            .search: "Búsqueda",
            .noStationsFound: "No se encontraron emisoras",
            .noFavoriteSearchResultsShowingCatalog: "No results found in your favorites.\nShowing results from the catalog.",
            .catalogEmpty: "Catálogo vacío",
            .noFavorites: "Aun no hay favoritos",
            .noCustomStations: "Aun no hay emisoras propias",
            .noRecents: "Aun no hay recientes",
            .trySearch: "Prueba con nombre, código de país o etiqueta.",
            .catalogNoRows: "El catálogo no ha cargado filas.",
            .tapHeart: "Toca el corazón en Now Playing para guardar una emisora.",
            .customStationsHint: "Toca el botón más para añadir tu propio stream.",
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
            .format: "formato",
            .genres: "géneros",
            .metadata: "metadatos",
            .unknown: "desconocido",
            .website: "web",
            .open: "abrir",
            .stream: "stream",
            .wakeTime: "Hora de alarma",
            .unset: "Quitar",
            .set: "Activar",
            .wakeHint: "Para mejorar la probabilidad de reproducción automática, mantén rrradio activo y habilita la opción de audio keep-alive.",
            .wakeNotificationsDeniedWarning: "Las notificaciones están desactivadas. La alarma no puede activarse de forma fiable - el iPhone puede seguir dormido a esa hora.",
            .openSettings: "Abrir Ajustes",
            .wakePauseWarningTitle: "La alarma puede no reproducir automáticamente",
            .wakePauseWarningMessage: "Pausaste la reproducción. iOS puede suspender rrradio antes de la alarma.\n\nLa alarma seguirá llegando como notificación que puedes tocar - pero no puede iniciar la radio automáticamente.\n\nPara reproducir automáticamente, mantén la radio sonando hasta la hora o crea una automatización de Atajos.",
            .dontShowAgain: "No mostrar de nuevo",
            .setupScheduledPlay: "Configurar reproducción programada",
            .setupScheduledPlayDetail: "Abre Atajos para reproducción programada. iOS puede requerir que el iPhone esté desbloqueado.",
            .wakeKeepAlive: "Mantener audio activo hasta la alarma",
            .wakeKeepAliveDetail: "Reproduce un sonido local casi silencioso para que iOS suspenda rrradio con menos probabilidad antes de la alarma. Usa batería y solo funciona si la app sigue en ejecución.",
            .playStationFirst: "Reproduce una emisora primero",
            .addStation: "Añadir emisora",
            .saveAnyway: "Guardar de todos modos",
        ],
    ]

    static func text(_ key: L10nKey, language: String) -> String {
        translations[language]?[key] ?? translations["en"]?[key] ?? key.rawValue
    }
}
