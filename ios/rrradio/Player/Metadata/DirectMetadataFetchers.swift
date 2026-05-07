import Foundation

private let statsWorkerBase = "https://rrradio-stats.markussteinbrecher.workers.dev"
private let statsProxyBase = "\(statsWorkerBase)/api/public/proxy"
private let bbcProxyBase = "\(statsWorkerBase)/api/public/bbc"

private struct AzuracastSong: Decodable {
    let artist: String?
    let title: String?
    let text: String?
}

private struct AzuracastNowPlaying: Decodable {
    let song: AzuracastSong?
}

private struct AzuracastResponse: Decodable {
    let nowPlaying: AzuracastNowPlaying?
    let isOnline: Bool?

    enum CodingKeys: String, CodingKey {
        case nowPlaying = "now_playing"
        case isOnline = "is_online"
    }
}

func fetchAzuracastMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: value) else { return nil }

    let data = try await fetchMetadataJSON(AzuracastResponse.self, url: url, fetch: fetch)
    guard data.isOnline != false else { return nil }
    let artist = data.nowPlaying?.song?.artist?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let title = data.nowPlaying?.song?.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty,
          title.range(of: "^station offline$", options: [.regularExpression, .caseInsensitive]) == nil else {
        return nil
    }

    return NowPlayingMetadata(
        artist: artist?.isEmpty == true ? nil : artist,
        title: title,
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct LautFmArtist: Decodable {
    let name: String?
}

private struct LautFmResponse: Decodable {
    let type: String?
    let title: String?
    let artist: LautFmArtist?
}

func fetchLautFmMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let slug = station.metadataUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !slug.isEmpty else {
        return nil
    }
    guard let url = URL(string: "https://api.laut.fm/station/\(slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug)/current_song") else {
        return nil
    }

    let data = try await fetchMetadataJSON(LautFmResponse.self, url: url, fetch: fetch)
    guard data.type == nil || data.type == "song" else { return nil }
    guard let title = data.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    let artist = data.artist?.name?.trimmingCharacters(in: .whitespacesAndNewlines)
    let formattedArtist = artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) }

    return NowPlayingMetadata(
        artist: formattedArtist,
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct StreamabcExtdata: Decodable {
    let album: String?
    let dirigent: String?
    let ensemble: String?
    let solist: String?
}

private struct StreamabcResponse: Decodable {
    let artist: String?
    let song: String?
    let album: String?
    let extdata: StreamabcExtdata?
}

func fetchStreamabcMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: value) else { return nil }

    let data = try await fetchMetadataJSON(StreamabcResponse.self, url: url, fetch: fetch)
    guard let title = data.song?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    let artist = data.artist?.trimmingCharacters(in: .whitespacesAndNewlines)
    let formattedArtist = artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) }

    return NowPlayingMetadata(
        artist: formattedArtist,
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct SwrPlaylistItem: Decodable {
    let artist: String?
    let title: String?
}

private struct SwrPresenter: Decodable {
    let displayname: String?
}

private struct SwrShowData: Decodable {
    let title: String?
    let presenter: [SwrPresenter]?
}

private struct SwrResponse: Decodable {
    let playlist: SwrPlaylist?
    let show: SwrShow?

    struct SwrPlaylist: Decodable {
        let data: [SwrPlaylistItem]?
    }

    struct SwrShow: Decodable {
        let data: SwrShowData?
    }
}

func fetchSwrMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: value) else { return nil }

    let data = try await fetchMetadataJSON(SwrResponse.self, url: url, fetch: fetch)
    guard let current = data.playlist?.data?.first,
          let title = current.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }
    let artist = current.artist?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct FfhStation: Decodable {
    let title: String?
    let artist: String?
    let claim: Bool?
}

private let ffhMetadataURL = URL(string: "https://www.ffh.de/update-onair-info?tx_ffhonair_pi2%5Baction%5D=getallsonginfo&tx_ffhonair_pi2%5Bcontroller%5D=Webradio&type=210&cHash=5a6b6b599e87ffbb02509dc06c14cbf7")!

func fetchFfhMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    let mount = station.metadataUrl?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        ? station.metadataUrl!.trimmingCharacters(in: .whitespacesAndNewlines)
        : "ffh"

    let data = try await fetchMetadataJSON([[String: FfhStation]].self, url: ffhMetadataURL, fetch: fetch)
    guard let entry = data.compactMap({ $0[mount] }).first, entry.claim != true else {
        return nil
    }
    guard let title = entry.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    let artist = entry.artist?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct MdrSong: Decodable {
    let status: String?
    let title: String?
    let interpret: String?
}

private struct MdrResponse: Decodable {
    let songs: [String: MdrSong]?

    enum CodingKeys: String, CodingKey {
        case songs = "Songs"
    }
}

func fetchMdrMetadata(
    station: Station,
    now: Date = Date(),
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, var components = URLComponents(string: value) else { return nil }
    if value.contains("xmlresp-index.do") {
        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "startdate" }) {
            items.append(URLQueryItem(name: "startdate", value: metadataYYYYMMDD(now)))
        }
        components.queryItems = items
    }
    guard let url = components.url else { return nil }

    let data = try await fetchMetadataJSON(MdrResponse.self, url: url, fetch: fetch)
    let songs = data.songs?.values.map { $0 } ?? []
    guard let current = songs.first(where: { $0.status == "now" }) ?? songs.first,
          let title = current.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }
    let artist = current.interpret?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private let radioEinsNowPlayingURL = URL(string: "https://www.radioeins.de/include/rad/nowonair/now_on_air.html")!

func fetchRadioEinsMetadata(
    station _: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    var components = URLComponents(url: radioEinsNowPlayingURL, resolvingAgainstBaseURL: false)
    components?.queryItems = [URLQueryItem(name: "_", value: String(Int(Date().timeIntervalSince1970 * 1000)))]
    guard let url = components?.url else { return nil }

    let text = try await fetchMetadataText(url: url, fetch: fetch)
    let pattern = #"<p\s+class="artist">([^<]*)</p>\s*<p\s+class="songtitle">([^<]*)</p>"#
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range),
          match.numberOfRanges == 3,
          let artistRange = Range(match.range(at: 1), in: text),
          let titleRange = Range(match.range(at: 2), in: text) else {
        return nil
    }

    let artist = String(text[artistRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    let title = String(text[titleRange]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return nil }

    return NowPlayingMetadata(
        artist: artist.isEmpty ? nil : artist,
        title: title,
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct CroNowEnvelope: Decodable {
    let data: CroNowData?
}

private struct CroNowData: Decodable {
    let status: String?
    let interpret: String?
    let track: String?
}

func fetchCroMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: value) else { return nil }

    let data = try await fetchMetadataJSON(CroNowEnvelope.self, url: url, fetch: fetch)
    guard data.data?.status == "playing",
          let title = data.data?.track?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }
    let artist = data.data?.interpret?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct SrgssrIlSong: Decodable {
    let isPlayingNow: Bool?
    let title: String?
    let artist: SrgssrIlArtist?
}

private struct SrgssrIlArtist: Decodable {
    let name: String?
}

private struct SrgssrIlSongList: Decodable {
    let songList: [SrgssrIlSong]?
}

func fetchSrgssrIlMetadata(
    station: Station,
    now: Date = Date(),
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, var components = URLComponents(string: value) else { return nil }
    let from = ISO8601DateFormatter().string(from: now.addingTimeInterval(-3 * 60 * 60))
    let to = ISO8601DateFormatter().string(from: now.addingTimeInterval(60 * 60))
    var queryItems = components.queryItems ?? []
    queryItems.append(URLQueryItem(name: "from", value: from))
    queryItems.append(URLQueryItem(name: "to", value: to))
    queryItems.append(URLQueryItem(name: "pageSize", value: "3"))
    components.queryItems = queryItems
    guard let url = components.url else { return nil }

    let data = try await fetchMetadataJSON(SrgssrIlSongList.self, url: url, fetch: fetch)
    let songs = data.songList ?? []
    guard let playing = songs.first(where: { $0.isPlayingNow == true }) ?? songs.first,
          let title = playing.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }
    let artist = playing.artist?.name?
        .replacingOccurrences(of: #"\s*\([A-Z]{2}\)\s*$"#, with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct RadioSwissResponse: Decodable {
    let channel: RadioSwissChannel?
}

private struct RadioSwissChannel: Decodable {
    let playingnow: RadioSwissNow?
}

private struct RadioSwissNow: Decodable {
    let current: RadioSwissPlaying?
}

private struct RadioSwissPlaying: Decodable {
    let metadata: RadioSwissMetadata?
}

private struct RadioSwissMetadata: Decodable {
    let artist: String?
    let title: String?
}

func fetchRadioSwissMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: value) else { return nil }

    let data = try await fetchMetadataJSON(RadioSwissResponse.self, url: url, fetch: fetch)
    guard let title = data.channel?.playingnow?.current?.metadata?.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }
    let artist = data.channel?.playingnow?.current?.metadata?.artist?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : $0 },
        title: title,
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct SrrLiveResponse: Decodable {
    let stations: [String: SrrStation]?
}

private struct SrrStation: Decodable {
    let title: String?
    let schedule: String?
}

func fetchSrrMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let meta = station.metadataUrl else { return nil }
    let pieces = meta.split(separator: "#", maxSplits: 1).map(String.init)
    guard pieces.count == 2, let url = URL(string: pieces[0]) else { return nil }

    let data = try await fetchMetadataJSON(SrrLiveResponse.self, url: url, fetch: fetch)
    let stationData = data.stations?[pieces[1]]
    guard let title = stationData?.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }

    return NowPlayingMetadata(
        artist: nil,
        title: nil,
        raw: title,
        programName: title,
        programSubtitle: stationData?.schedule?.trimmingCharacters(in: .whitespacesAndNewlines),
    )
}

func fetchMrMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: value) else { return nil }
    let text = try await fetchMetadataText(url: url, fetch: fetch)
    guard let name = firstXMLTag("Name", in: text), !name.isEmpty else { return nil }
    let parts = name.components(separatedBy: " - ")
    if parts.count >= 2 {
        let artist = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let title = parts.dropFirst().joined(separator: " - ").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }
        return NowPlayingMetadata(
            artist: artist.isEmpty ? nil : metadataTitleCase(artist),
            title: metadataTitleCase(title),
            raw: metadataRaw(artist: artist, title: title),
        )
    }
    return NowPlayingMetadata(artist: nil, title: metadataTitleCase(name), raw: name)
}

private func firstXMLTag(_ tag: String, in text: String) -> String? {
    let pattern = "<\(tag)>\\s*([^<]+?)\\s*</\(tag)>"
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
        return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range),
          match.numberOfRanges == 2,
          let valueRange = Range(match.range(at: 1), in: text) else {
        return nil
    }
    return String(text[valueRange]).trimmingCharacters(in: .whitespacesAndNewlines)
}

private struct BrTrack: Decodable {
    let interpret: String?
    let title: String?
    let startTime: String?
    let endTime: String?
}

private struct BrPlayer: Decodable {
    let tracks: [BrTrack]?
}

func fetchBrMetadata(
    station: Station,
    now: Date = Date(),
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: proxiedURL(value)) else { return nil }
    let text = try await fetchMetadataText(url: url, fetch: fetch)
    let data = try JSONDecoder().decode(BrPlayer.self, from: looseJSONData(from: text))
    let tracks = data.tracks ?? []
    let current = tracks.first { track in
        guard let start = track.startTime.flatMap(isoDate),
              let end = track.endTime.flatMap(isoDate) else {
            return false
        }
        return start <= now && now < end
    } ?? tracks.first

    guard let title = current?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    let artist = current?.interpret?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct BbcEnvelope: Decodable {
    let data: [BbcModule]?
}

private struct BbcModule: Decodable {
    let id: String?
    let data: [BbcBroadcast]?
}

private struct BbcBroadcast: Decodable {
    let titles: BbcTitles?
}

private struct BbcTitles: Decodable {
    let primary: String?
    let secondary: String?
}

func fetchBbcMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let service = station.metadataUrl?.split(separator: "/").last.map(String.init), !service.isEmpty,
          let url = URL(string: "\(bbcProxyBase)/play/\(service)") else {
        return nil
    }

    let data = try await fetchMetadataJSON(BbcEnvelope.self, url: url, fetch: fetch)
    let item = data.data?.first(where: { $0.id == "live_play_area" })?.data?.first
    guard let title = item?.titles?.primary?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    return NowPlayingMetadata(
        artist: nil,
        title: nil,
        raw: title,
        programName: title,
        programSubtitle: item?.titles?.secondary?.trimmingCharacters(in: .whitespacesAndNewlines),
    )
}

private struct HrBroadcast: Decodable {
    let startTS: Double?
    let endTS: Double?
    let title: String?
    let hosts: HrHosts?
    let currentBroadcast: Bool?
}

private struct HrHosts: Decodable {
    let name: String?
}

func fetchHrMetadata(
    station: Station,
    now: Date = Date(),
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
    icyFetch: @escaping StationMetadataFetcher = { try await fetchIcyMetadata(station: $0) },
) async throws -> NowPlayingMetadata? {
    async let program = fetchHrProgramFallback(station: station, now: now, fetch: fetch)
    async let icy = fetchOptionalIcy(station: station, icyFetch: icyFetch)

    if let icyMetadata = await icy {
        return icyMetadata
    }
    return await program
}

private func fetchOptionalIcy(
    station: Station,
    icyFetch: @escaping StationMetadataFetcher,
) async -> NowPlayingMetadata? {
    do {
        return try await icyFetch(station)
    } catch {
        return nil
    }
}

private func fetchHrProgramFallback(
    station: Station,
    now: Date,
    fetch: MetadataDataFetcher,
) async -> NowPlayingMetadata? {
    do {
        guard let value = station.metadataUrl, let url = URL(string: proxiedURL(value)) else { return nil }
        let broadcasts = try await fetchMetadataJSON([HrBroadcast].self, url: url, fetch: fetch)
        let nowMillis = now.timeIntervalSince1970 * 1000
        let current = broadcasts.first(where: { $0.currentBroadcast == true })
            ?? broadcasts.first { broadcast in
                guard let start = broadcast.startTS, let end = broadcast.endTS else { return false }
                return start <= nowMillis && nowMillis < end
            }

        guard let title = current?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
            return nil
        }
        let host = current?.hosts?.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let subtitle = host?.isEmpty == false ? "mit \(host!)" : nil
        let raw = [title, subtitle].compactMap { $0 }.joined(separator: " - ")
        return NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: raw,
            programName: title,
            programSubtitle: subtitle,
        )
    } catch {
        return nil
    }
}

private struct AntenneResponse: Decodable {
    let data: [AntenneStation]?
}

private struct AntenneStation: Decodable {
    let mountpoint: String?
    let artist: String?
    let title: String?
    let `class`: String?
}

func fetchAntenneMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl,
          let hashIndex = value.firstIndex(of: "#") else {
        return nil
    }
    let apiURL = String(value[..<hashIndex])
    let mountpoint = String(value[value.index(after: hashIndex)...])
    guard let url = URL(string: proxiedURL(apiURL)) else { return nil }

    let data = try await fetchMetadataJSON(AntenneResponse.self, url: url, fetch: fetch)
    guard let entry = data.data?.first(where: { $0.mountpoint == mountpoint }),
          entry.class == "Music",
          let title = entry.title?.trimmingCharacters(in: .whitespacesAndNewlines),
          !title.isEmpty else {
        return nil
    }
    let artist = entry.artist?.trimmingCharacters(in: .whitespacesAndNewlines)

    return NowPlayingMetadata(
        artist: artist.flatMap { $0.isEmpty ? nil : metadataTitleCase($0) },
        title: metadataTitleCase(title),
        raw: metadataRaw(artist: artist, title: title),
    )
}

private struct BremenResponse: Decodable {
    let currentBroadcast: BremenBroadcast?
}

private struct BremenBroadcast: Decodable {
    let title: String?
    let titleAddon: String?
}

func fetchRadioBremenMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: proxiedURL(value)) else { return nil }
    let data = try await fetchMetadataJSON(BremenResponse.self, url: url, fetch: fetch)
    guard let title = data.currentBroadcast?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    return NowPlayingMetadata(
        artist: nil,
        title: nil,
        raw: title,
        programName: title,
        programSubtitle: data.currentBroadcast?.titleAddon?.trimmingCharacters(in: .whitespacesAndNewlines),
    )
}

private struct SrResponse: Decodable {
    let nowPlaying: [String: SrEntry]?

    enum CodingKeys: String, CodingKey {
        case nowPlaying = "now playing"
    }
}

private struct SrEntry: Decodable {
    let titel: String?
    let moderator: String?
    let start: String?
    let ende: String?
}

func fetchSrMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard let value = station.metadataUrl, let url = URL(string: proxiedURL(value)) else { return nil }
    let data = try await fetchMetadataJSON(SrResponse.self, url: url, fetch: fetch)
    guard let title = data.nowPlaying?.values.first?.titel?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
        return nil
    }
    return NowPlayingMetadata(
        artist: nil,
        title: nil,
        raw: title,
        programName: title,
        programSubtitle: data.nowPlaying?.values.first?.moderator?.trimmingCharacters(in: .whitespacesAndNewlines),
    )
}

private func proxiedURL(_ value: String) -> String {
    "\(statsProxyBase)?url=\(value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value)"
}

private func isoDate(_ value: String) -> Date? {
    ISO8601DateFormatter().date(from: value)
}
