import XCTest
@testable import rrradio

final class IcyMetadataFetcherTests: XCTestCase {
    private func station() -> Station {
        Station(
            id: "icy",
            name: "ICY",
            streamUrl: URL(string: "https://example.com/stream")!,
            metadataUrl: nil,
            metadata: nil,
        )
    }

    private func response(for url: URL, statusCode: Int = 200, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!
    }

    func testParsesArtistAndTitle() {
        XCTAssertEqual(
            parseIcyStreamTitle("Pet Shop Boys - Liberation"),
            NowPlayingMetadata(artist: "Pet Shop Boys", title: "Liberation", raw: "Pet Shop Boys - Liberation"),
        )
    }

    func testSplitsOnlyAtFirstSeparator() {
        XCTAssertEqual(
            parseIcyStreamTitle("Daft Punk - One More Time - Edit"),
            NowPlayingMetadata(artist: "Daft Punk", title: "One More Time - Edit", raw: "Daft Punk - One More Time - Edit"),
        )
        XCTAssertEqual(
            parseIcyStreamTitle("NDR Info - Die Nachrichten für den Norden - ndr.de/info"),
            NowPlayingMetadata(artist: "NDR Info", title: "Die Nachrichten für den Norden - ndr.de/info", raw: "NDR Info - Die Nachrichten für den Norden - ndr.de/info"),
        )
    }

    func testKeepsTrackOnlyTitlesWithoutSafeSeparator() {
        XCTAssertEqual(
            parseIcyStreamTitle("Wir sind der Westen."),
            NowPlayingMetadata(artist: nil, title: "Wir sind der Westen.", raw: "Wir sind der Westen."),
        )
        XCTAssertEqual(
            parseIcyStreamTitle("- Track Name"),
            NowPlayingMetadata(artist: nil, title: "- Track Name", raw: "- Track Name"),
        )
        XCTAssertEqual(
            parseIcyStreamTitle("Artist -"),
            NowPlayingMetadata(artist: nil, title: "Artist -", raw: "Artist -"),
        )
    }

    func testTrimsEmptyAndWhitespaceOnlyTitles() {
        XCTAssertEqual(
            parseIcyStreamTitle("  ABBA  -  Dancing Queen  "),
            NowPlayingMetadata(artist: "ABBA ", title: " Dancing Queen", raw: "ABBA  -  Dancing Queen"),
        )
        XCTAssertNil(parseIcyStreamTitle(""))
        XCTAssertNil(parseIcyStreamTitle("   "))
    }

    func testExtractsPreciseIcyMetadataBlock() {
        let audio = Data("abcde".utf8)
        let metadata = paddedMetadataBlock("StreamTitle='Artist - Song';", lengthByte: 2)
        var data = Data()
        data.append(audio)
        data.append(2)
        data.append(metadata)

        XCTAssertEqual(icyStreamTitle(from: data, metaint: 5), "Artist - Song")
    }

    func testReturnsEmptyStringForEmptyPreciseMetadataBlock() {
        var data = Data("abcde".utf8)
        data.append(0)

        XCTAssertEqual(icyStreamTitle(from: data, metaint: 5), "")
    }

    func testScansForStreamTitleWhenMetaintIsMissing() {
        let data = Data("noise StreamTitle='Artist - Song'; more noise".utf8)

        XCTAssertEqual(icyStreamTitle(from: data, metaint: nil), "Artist - Song")
    }

    func testDecodesLatin1WhenUtf8ContainsReplacementCharacters() {
        var data = Data("noise StreamTitle='Beyonc".utf8)
        data.append(0xE9)
        data.append(contentsOf: " - Deja Vu';".utf8)

        XCTAssertEqual(icyStreamTitle(from: data, metaint: nil), "Beyoncé - Deja Vu")
    }

    func testFetchIcyMetadataFromDataResponseSendsIcyHeaderAndUsesResponseMetaint() async throws {
        let station = station()
        let metadata = paddedMetadataBlock("StreamTitle='Artist - Song';", lengthByte: 2)
        var body = Data("abcde".utf8)
        body.append(2)
        body.append(metadata)

        let result = try await fetchIcyMetadataFromDataResponse(station: station) { request in
            XCTAssertEqual(request.url, station.streamUrl)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Icy-MetaData"), "1")
            return (body, self.response(for: station.streamUrl, headers: ["icy-metaint": "5"]))
        }

        XCTAssertEqual(result, NowPlayingMetadata(artist: "Artist", title: "Song", raw: "Artist - Song"))
    }

    func testFindsLastHlsTimedMetadataSegmentURL() {
        let playlist = """
        #EXTM3U
        #EXT-X-TARGETDURATION:7
        #EXTINF:6.016,
        first.aac
        #EXTINF:6.016,
        segments/latest.aac
        """

        XCTAssertEqual(
            hlsTimedMetadataSegmentURL(
                from: playlist,
                playlistURL: URL(string: "https://example.com/live/chunks.m3u8")!,
            ),
            URL(string: "https://example.com/live/segments/latest.aac"),
        )
    }

    func testParsesHlsTimedMetadataTitleFrame() {
        let metadata = parseHlsTimedMetadata(from: hlsID3Segment(title: "Pablo López - El niño del espacio"))

        XCTAssertEqual(
            metadata,
            NowPlayingMetadata(artist: "Pablo López", title: "El niño del espacio", raw: "Pablo López - El niño del espacio"),
        )
    }

    func testFetchHlsTimedMetadataReadsPlaylistAndSegmentHeader() async throws {
        let playlistURL = URL(string: "https://example.com/live/chunks.m3u8")!
        let segmentURL = URL(string: "https://example.com/live/latest.aac")!
        let station = Station(
            id: "hls",
            name: "HLS",
            streamUrl: playlistURL,
            metadataUrl: nil,
            metadata: nil,
            status: "stream-only",
        )
        let playlist = """
        #EXTM3U
        #EXT-X-TARGETDURATION:7
        #EXTINF:6.016,
        latest.aac
        """.data(using: .utf8)!
        let segment = hlsID3Segment(title: "Artist - Song")
        var segmentRange: String?

        let metadata = try await fetchHlsTimedMetadata(station: station) { request in
            if request.url == playlistURL {
                return (playlist, self.response(for: playlistURL))
            }
            if request.url == segmentURL {
                segmentRange = request.value(forHTTPHeaderField: "Range")
                return (segment, self.response(for: segmentURL, statusCode: 206))
            }
            XCTFail("Unexpected request: \(request.url?.absoluteString ?? "nil")")
            return (Data(), self.response(for: request.url ?? playlistURL, statusCode: 404))
        }

        XCTAssertEqual(metadata, NowPlayingMetadata(artist: "Artist", title: "Song", raw: "Artist - Song"))
        XCTAssertEqual(segmentRange, "bytes=0-98303")
    }

    func testRegistryFindsIcyOnlyStations() {
        var station = station()
        station.status = "icy-only"

        XCTAssertNotNil(metadataFetcher(for: station))
    }

    private func paddedMetadataBlock(_ value: String, lengthByte: UInt8) -> Data {
        let targetLength = Int(lengthByte) * 16
        var data = Data(value.utf8)
        if data.count < targetLength {
            data.append(contentsOf: repeatElement(0, count: targetLength - data.count))
        }
        return data
    }

    private func hlsID3Segment(title: String) -> Data {
        let frames = id3TextFrame(id: "TIT2", value: title)
        var tag = Data("ID3".utf8)
        tag.append(contentsOf: [4, 0, 0])
        tag.append(contentsOf: synchsafeBytes(frames.count))
        tag.append(frames)
        tag.append(Data("audio".utf8))
        return tag
    }

    private func id3TextFrame(id: String, value: String) -> Data {
        var payload = Data([3])
        payload.append(Data(value.utf8))

        var frame = Data(id.utf8)
        frame.append(contentsOf: synchsafeBytes(payload.count))
        frame.append(contentsOf: [0, 0])
        frame.append(payload)
        return frame
    }

    private func synchsafeBytes(_ value: Int) -> [UInt8] {
        [
            UInt8((value >> 21) & 0x7F),
            UInt8((value >> 14) & 0x7F),
            UInt8((value >> 7) & 0x7F),
            UInt8(value & 0x7F),
        ]
    }
}
