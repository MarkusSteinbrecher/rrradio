import XCTest
@testable import rrradio

final class DirectMetadataFetcherTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_714_780_800)

    private func station(metadata: String, metadataUrl: String?) -> Station {
        Station(
            id: metadata,
            name: metadata,
            streamUrl: URL(string: "https://example.com/stream")!,
            metadataUrl: metadataUrl,
            metadata: metadata,
        )
    }

    private func response(for url: URL, statusCode: Int = 200) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    func testFetchesAzuracastSong() async throws {
        let url = URL(string: "https://radio.example.com/api/nowplaying/main")!
        let body = """
        {
          "is_online": true,
          "now_playing": {
            "song": { "artist": "Artist", "title": "Song" }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchAzuracastMetadata(station: station(metadata: "azuracast", metadataUrl: url.absoluteString)) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Artist", title: "Song", raw: "Artist - Song"))
    }

    func testAzuracastSkipsOfflineSentinel() async throws {
        let url = URL(string: "https://radio.example.com/api/nowplaying/main")!
        let body = """
        {
          "is_online": true,
          "now_playing": {
            "song": { "artist": "", "title": "Station Offline" }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchAzuracastMetadata(station: station(metadata: "azuracast", metadataUrl: url.absoluteString)) { _ in
            (body, self.response(for: url))
        }

        XCTAssertNil(metadata)
    }

    func testFetchesLautFmSongFromSlug() async throws {
        let expectedURL = URL(string: "https://api.laut.fm/station/mangoradio/current_song")!
        let body = """
        {
          "type": "song",
          "title": "BIG SONG",
          "artist": { "name": "LOUD ARTIST" }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchLautFmMetadata(station: station(metadata: "laut-fm", metadataUrl: "mangoradio")) { request in
            XCTAssertEqual(request.url, expectedURL)
            return (body, self.response(for: expectedURL))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Loud Artist", title: "Big Song", raw: "LOUD ARTIST - BIG SONG"))
    }

    func testLautFmSkipsNonSongItems() async throws {
        let body = """
        { "type": "jingle", "title": "Station ID", "artist": { "name": "Brand" } }
        """.data(using: .utf8)!

        let metadata = try await fetchLautFmMetadata(station: station(metadata: "laut-fm", metadataUrl: "mangoradio")) { request in
            (body, self.response(for: request.url!))
        }

        XCTAssertNil(metadata)
    }

    func testFetchesStreamabcSong() async throws {
        let url = URL(string: "https://api.streamabc.net/metadata/channel/klassikr-live.json")!
        let body = """
        {
          "artist": "ORCHESTRA",
          "song": "SYMPHONY",
          "album": "Album"
        }
        """.data(using: .utf8)!

        let metadata = try await fetchStreamabcMetadata(station: station(metadata: "streamabc", metadataUrl: url.absoluteString)) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Orchestra", title: "Symphony", raw: "ORCHESTRA - SYMPHONY"))
    }

    func testRegistryFindsDirectFetchers() {
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "azuracast", metadataUrl: "https://radio.example.com/api/nowplaying/main")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "laut-fm", metadataUrl: "mangoradio")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "streamabc", metadataUrl: "https://api.streamabc.net/metadata/channel/klassikr-live.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "swr", metadataUrl: "https://www.swr.de/playerbar.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "ffh", metadataUrl: "ffhplus80er")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "mdr", metadataUrl: "https://www.mdr.de/XML/titellisten/jump_onair.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "rbb-radioeins", metadataUrl: nil)))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "cro", metadataUrl: "https://api.rozhlas.cz/data/v2/playlist/now/radiozurnal.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "srgssr-il", metadataUrl: "https://il.srgssr.ch/integrationlayer/2.0/songs/byChannel/rtr")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "swiss-radio", metadataUrl: "https://api.radioswisspop.ch/api/v1/pop/en/playlist_small")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "srr", metadataUrl: "https://www.srr.ro/live.php#rractualitati")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "mr", metadataUrl: "https://mediaklikk.hu/iface/radio_now/now_9.xml")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "br-radioplayer", metadataUrl: "https://www.br.de/radio/bayern2/programmkalender/radioplayer100~radioplayer.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "bbc", metadataUrl: "bbc_world_service")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "hr", metadataUrl: "https://www.hr1.de/sendungen/sendezeiten/radioprogramm-hr1-100~radioplayer.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "antenne", metadataUrl: "https://www.antenne.de/api/metadata/now#chillout")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "rb-bremen", metadataUrl: "https://www.radiobremen.de/live/rb/current.json")))
        XCTAssertNotNil(metadataFetcher(for: station(metadata: "sr", metadataUrl: "https://www.sr.de/sr/epg/nowPlaying.jsp?welle=sr1")))
    }

    func testFetchesSwrSong() async throws {
        let url = URL(string: "https://www.swr.de/playerbar.json")!
        let body = """
        {
          "playlist": {
            "data": [
              { "artist": "SWR ARTIST", "title": "SWR SONG" }
            ]
          },
          "show": {
            "data": {
              "title": "Show",
              "presenter": [{ "displayname": "Host" }]
            }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchSwrMetadata(station: station(metadata: "swr", metadataUrl: url.absoluteString)) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Swr Artist", title: "Swr Song", raw: "SWR ARTIST - SWR SONG"))
    }

    func testSwrSkipsWhenOnlyProgramIsPresent() async throws {
        let url = URL(string: "https://www.swr.de/playerbar.json")!
        let body = """
        { "show": { "data": { "title": "Show" } } }
        """.data(using: .utf8)!

        let metadata = try await fetchSwrMetadata(station: station(metadata: "swr", metadataUrl: url.absoluteString)) { _ in
            (body, self.response(for: url))
        }

        XCTAssertNil(metadata)
    }

    func testFetchesFfhMount() async throws {
        let body = """
        [
          { "ffh": { "claim": true, "artist": "HIT RADIO FFH", "title": "Brand" } },
          { "ffhplus80er": { "artist": "FFH ARTIST", "title": "FFH SONG" } }
        ]
        """.data(using: .utf8)!

        let metadata = try await fetchFfhMetadata(station: station(metadata: "ffh", metadataUrl: "ffhplus80er")) { request in
            XCTAssertEqual(request.url?.host, "www.ffh.de")
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Ffh Artist", title: "Ffh Song", raw: "FFH ARTIST - FFH SONG"))
    }

    func testFfhDefaultsToMainMountAndSkipsClaimRows() async throws {
        let body = """
        [{ "ffh": { "claim": true, "artist": "HIT RADIO FFH", "title": "Brand" } }]
        """.data(using: .utf8)!

        let metadata = try await fetchFfhMetadata(station: station(metadata: "ffh", metadataUrl: nil)) { request in
            (body, self.response(for: request.url!))
        }

        XCTAssertNil(metadata)
    }

    func testFetchesMdrCurrentSong() async throws {
        let url = URL(string: "https://www.mdr.de/XML/titellisten/jump_onair.json")!
        let body = """
        {
          "Songs": {
            "0": { "status": "old", "interpret": "OLD ARTIST", "title": "OLD SONG" },
            "1": { "status": "now", "interpret": "MDR ARTIST", "title": "MDR SONG" }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchMdrMetadata(station: station(metadata: "mdr", metadataUrl: url.absoluteString), now: now) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Mdr Artist", title: "Mdr Song", raw: "MDR ARTIST - MDR SONG"))
    }

    func testMdrAppendsStartdateForXmlrespFeeds() async throws {
        let baseURL = "https://www.mdr.de/scripts4/titellisten/xmlresp-index.do?output=json&idwelle=1&amount=1"
        let body = """
        { "Songs": { "0": { "status": "old", "interpret": "MDR ARTIST", "title": "MDR SONG" } } }
        """.data(using: .utf8)!

        let metadata = try await fetchMdrMetadata(station: station(metadata: "mdr", metadataUrl: baseURL), now: now) { request in
            XCTAssertEqual(request.url?.query?.contains("startdate=20240504"), true)
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Mdr Artist", title: "Mdr Song", raw: "MDR ARTIST - MDR SONG"))
    }

    func testFetchesRadioEinsHtmlFragment() async throws {
        let body = """
        <p class="artist">Radio Artist</p>
        <p class="songtitle">Radio Song</p>
        """.data(using: .utf8)!

        let metadata = try await fetchRadioEinsMetadata(station: station(metadata: "rbb-radioeins", metadataUrl: nil)) { request in
            XCTAssertEqual(request.url?.host, "www.radioeins.de")
            XCTAssertEqual(request.url?.path, "/include/rad/nowonair/now_on_air.html")
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Radio Artist", title: "Radio Song", raw: "Radio Artist - Radio Song"))
    }

    func testFetchesCroCurrentTrack() async throws {
        let url = URL(string: "https://api.rozhlas.cz/data/v2/playlist/now/radiozurnal.json")!
        let body = """
        { "data": { "status": "playing", "interpret": "CRO ARTIST", "track": "CRO SONG" } }
        """.data(using: .utf8)!

        let metadata = try await fetchCroMetadata(station: station(metadata: "cro", metadataUrl: url.absoluteString)) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Cro Artist", title: "Cro Song", raw: "CRO ARTIST - CRO SONG"))
    }

    func testCroSkipsQuietStatus() async throws {
        let url = URL(string: "https://api.rozhlas.cz/data/v2/playlist/now/radiozurnal.json")!
        let body = """
        { "data": { "status": "quiet", "interpret": "CRO ARTIST", "track": "CRO SONG" } }
        """.data(using: .utf8)!

        let metadata = try await fetchCroMetadata(station: station(metadata: "cro", metadataUrl: url.absoluteString)) { _ in
            (body, self.response(for: url))
        }

        XCTAssertNil(metadata)
    }

    func testFetchesSrgssrIlCurrentSong() async throws {
        let baseURL = "https://il.srgssr.ch/integrationlayer/2.0/songs/byChannel/rtr"
        let body = """
        {
          "songList": [
            { "isPlayingNow": false, "title": "OLD SONG", "artist": { "name": "OLD ARTIST" } },
            { "isPlayingNow": true, "title": "SRG SONG", "artist": { "name": "SRG ARTIST (CH)" } }
          ]
        }
        """.data(using: .utf8)!

        let metadata = try await fetchSrgssrIlMetadata(station: station(metadata: "srgssr-il", metadataUrl: baseURL), now: now) { request in
            XCTAssertEqual(request.url?.query?.contains("pageSize=3"), true)
            XCTAssertEqual(request.url?.query?.contains("from="), true)
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Srg Artist", title: "Srg Song", raw: "SRG ARTIST - SRG SONG"))
    }

    func testFetchesRadioSwissSong() async throws {
        let url = URL(string: "https://api.radioswisspop.ch/api/v1/pop/en/playlist_small")!
        let body = """
        {
          "channel": {
            "playingnow": {
              "current": {
                "metadata": { "artist": "Swiss Artist", "title": "Swiss Song" }
              }
            }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchRadioSwissMetadata(station: station(metadata: "swiss-radio", metadataUrl: url.absoluteString)) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Swiss Artist", title: "Swiss Song", raw: "Swiss Artist - Swiss Song"))
    }

    func testFetchesSrrProgramTitle() async throws {
        let url = URL(string: "https://www.srr.ro/live.php")!
        let body = """
        {
          "stations": {
            "rractualitati": {
              "title": "Current Program",
              "schedule": "Host"
            }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchSrrMetadata(station: station(metadata: "srr", metadataUrl: "\(url.absoluteString)#rractualitati")) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "Current Program",
            programName: "Current Program",
            programSubtitle: "Host",
        ))
    }

    func testFetchesMrCurrentTrackFromXML() async throws {
        let url = URL(string: "https://mediaklikk.hu/iface/radio_now/now_9.xml")!
        let body = """
        <Root>
          <Item>
            <Name>MR ARTIST - MR SONG</Name>
          </Item>
        </Root>
        """.data(using: .utf8)!

        let metadata = try await fetchMrMetadata(station: station(metadata: "mr", metadataUrl: url.absoluteString)) { request in
            XCTAssertEqual(request.url, url)
            return (body, self.response(for: url))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Mr Artist", title: "Mr Song", raw: "MR ARTIST - MR SONG"))
    }

    func testFetchesBrCurrentTrack() async throws {
        let sourceURL = "https://www.br.de/radio/bayern2/programmkalender/radioplayer100~radioplayer.json"
        let body = """
        //@formatter:off
        {
          "tracks": [
            {
              "interpret": "BR ARTIST",
              "title": "BR SONG",
              "startTime": "2024-05-04T10:00:00Z",
              "endTime": "2024-05-04T12:00:00Z"
            }
          ]
        }
        """.data(using: .utf8)!

        let metadata = try await fetchBrMetadata(station: station(metadata: "br-radioplayer", metadataUrl: sourceURL), now: now) { request in
            XCTAssertEqual(request.url?.host, "rrradio-stats.markussteinbrecher.workers.dev")
            XCTAssertEqual(request.url?.absoluteString.contains("br.de"), true)
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Br Artist", title: "Br Song", raw: "BR ARTIST - BR SONG"))
    }

    func testFetchesBbcProgramTitle() async throws {
        let body = """
        {
          "data": [
            {
              "id": "live_play_area",
              "data": [
                { "titles": { "primary": "BBC Program", "secondary": "Host" } }
              ]
            }
          ]
        }
        """.data(using: .utf8)!

        let metadata = try await fetchBbcMetadata(station: station(metadata: "bbc", metadataUrl: "bbc_world_service")) { request in
            XCTAssertEqual(request.url?.path, "/api/public/bbc/play/bbc_world_service")
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "BBC Program",
            programName: "BBC Program",
            programSubtitle: "Host",
        ))
    }

    func testFetchesHrIcyTrackBeforeProgramFallback() async throws {
        let url = URL(string: "https://www.hr1.de/sendungen/sendezeiten/radioprogramm-hr1-100~radioplayer.json")!
        let body = """
        [
          {
            "startTS": 1714780000000,
            "endTS": 1714790000000,
            "title": "hr1 am Vormittag",
            "hosts": { "name": "Host Name" },
            "currentBroadcast": true
          }
        ]
        """.data(using: .utf8)!
        let icy = NowPlayingMetadata(artist: "Track Artist", title: "Track Title", raw: "Track Artist - Track Title")

        let metadata = try await fetchHrMetadata(
            station: station(metadata: "hr", metadataUrl: url.absoluteString),
            now: now,
            fetch: { request in
                XCTAssertEqual(request.url?.host, "rrradio-stats.markussteinbrecher.workers.dev")
                XCTAssertEqual(request.url?.path, "/api/public/proxy")
                return (body, self.response(for: request.url!))
            },
            icyFetch: { station in
                XCTAssertEqual(station.metadata, "hr")
                return icy
            },
        )

        XCTAssertEqual(metadata, icy)
    }

    func testFetchesHrProgramWhenIcyIsUnavailable() async throws {
        let url = URL(string: "https://www.hr1.de/sendungen/sendezeiten/radioprogramm-hr1-100~radioplayer.json")!
        let body = """
        [
          {
            "startTS": 1714780000000,
            "endTS": 1714790000000,
            "title": "hr1 am Vormittag",
            "hosts": { "name": "Host Name" },
            "currentBroadcast": false
          }
        ]
        """.data(using: .utf8)!

        let metadata = try await fetchHrMetadata(
            station: station(metadata: "hr", metadataUrl: url.absoluteString),
            now: now,
            fetch: { request in
                XCTAssertEqual(request.url?.query?.contains("hr1.de"), true)
                return (body, self.response(for: request.url!))
            },
            icyFetch: { _ in
                throw URLError(.cannotParseResponse)
            },
        )

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "hr1 am Vormittag - mit Host Name",
            programName: "hr1 am Vormittag",
            programSubtitle: "mit Host Name",
        ))
    }

    func testHrUsesCurrentBroadcastFlagBeforeTimeWindow() async throws {
        let url = URL(string: "https://www.hr3.de/shows/guide_hrthree-102~radioplayer.json")!
        let body = """
        [
          {
            "startTS": 1714780000000,
            "endTS": 1714790000000,
            "title": "Time Window Show",
            "currentBroadcast": false
          },
          {
            "startTS": 1714700000000,
            "endTS": 1714710000000,
            "title": "Flagged Show",
            "currentBroadcast": true
          }
        ]
        """.data(using: .utf8)!

        let metadata = try await fetchHrMetadata(
            station: station(metadata: "hr", metadataUrl: url.absoluteString),
            now: now,
            fetch: { request in
                (body, self.response(for: request.url!))
            },
            icyFetch: { _ in nil },
        )

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "Flagged Show",
            programName: "Flagged Show",
        ))
    }

    func testFetchesAntenneMusicEntry() async throws {
        let sourceURL = "https://www.antenne.de/api/metadata/now#chillout"
        let body = """
        {
          "data": [
            { "mountpoint": "main", "class": "Jingle", "artist": "Brand", "title": "Station ID" },
            { "mountpoint": "chillout", "class": "Music", "artist": "ANTENNE ARTIST", "title": "ANTENNE SONG" }
          ]
        }
        """.data(using: .utf8)!

        let metadata = try await fetchAntenneMetadata(station: station(metadata: "antenne", metadataUrl: sourceURL)) { request in
            XCTAssertEqual(request.url?.absoluteString.contains("antenne.de"), true)
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Antenne Artist", title: "Antenne Song", raw: "ANTENNE ARTIST - ANTENNE SONG"))
    }

    func testAntenneSkipsNonMusicEntries() async throws {
        let body = """
        { "data": [{ "mountpoint": "chillout", "class": "Jingle", "artist": "Brand", "title": "Station ID" }] }
        """.data(using: .utf8)!

        let metadata = try await fetchAntenneMetadata(station: station(metadata: "antenne", metadataUrl: "https://www.antenne.de/api/metadata/now#chillout")) { request in
            (body, self.response(for: request.url!))
        }

        XCTAssertNil(metadata)
    }

    func testFetchesRadioBremenProgramTitle() async throws {
        let body = """
        { "currentBroadcast": { "title": "Bremen Program", "titleAddon": "Host" } }
        """.data(using: .utf8)!

        let metadata = try await fetchRadioBremenMetadata(station: station(metadata: "rb-bremen", metadataUrl: "https://www.radiobremen.de/live/rb/current.json")) { request in
            XCTAssertEqual(request.url?.absoluteString.contains("radiobremen.de"), true)
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "Bremen Program",
            programName: "Bremen Program",
            programSubtitle: "Host",
        ))
    }

    func testFetchesSrProgramTitle() async throws {
        let body = """
        {
          "now playing": {
            "sr1": {
              "titel": "SR Program",
              "moderator": "Host"
            }
          }
        }
        """.data(using: .utf8)!

        let metadata = try await fetchSrMetadata(station: station(metadata: "sr", metadataUrl: "https://www.sr.de/sr/epg/nowPlaying.jsp?welle=sr1")) { request in
            XCTAssertEqual(request.url?.absoluteString.contains("sr.de"), true)
            return (body, self.response(for: request.url!))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(
            artist: nil,
            title: nil,
            raw: "SR Program",
            programName: "SR Program",
            programSubtitle: "Host",
        ))
    }
}
