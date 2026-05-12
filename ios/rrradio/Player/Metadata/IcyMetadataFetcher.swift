import Foundation

private let icyMetadataMaximumScanBytes = 96 * 1024
private let icyMetadataMaximumBlockBytes = 255 * 16
private let hlsTimedMetadataMaximumSegmentBytes = 96 * 1024
private let streamTitleMarker = "StreamTitle='"
private let id3Marker = Array("ID3".utf8)

func parseIcyStreamTitle(_ raw: String) -> NowPlayingMetadata? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    if let separator = trimmed.range(of: " - "),
       separator.lowerBound != trimmed.startIndex,
       separator.upperBound != trimmed.endIndex {
        let artist = String(trimmed[..<separator.lowerBound])
        let title = String(trimmed[separator.upperBound...])
        return NowPlayingMetadata(artist: artist, title: title, raw: trimmed)
    }

    return NowPlayingMetadata(artist: nil, title: trimmed, raw: trimmed)
}

func icyStreamTitle(from data: Data, metaint: Int?) -> String? {
    if let metaint, metaint > 0 {
        return preciseIcyStreamTitle(from: data, metaint: metaint)
    }
    return scannedIcyStreamTitle(from: data)
}

func fetchIcyMetadata(
    station: Station
) async throws -> NowPlayingMetadata? {
    var request = URLRequest(url: station.streamUrl)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 10
    request.setValue("1", forHTTPHeaderField: "Icy-MetaData")

    let (bytes, response) = try await URLSession.shared.bytes(for: request)
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        throw URLError(.badServerResponse)
    }

    guard let raw = try await readIcyStreamTitle(from: bytes, metaint: icyMetaint(from: http)) else {
        throw URLError(.cannotParseResponse)
    }
    return parseIcyStreamTitle(raw)
}

func fetchIcyMetadataFromDataResponse(
    station: Station,
    fetch: MetadataDataFetcher,
) async throws -> NowPlayingMetadata? {
    var request = URLRequest(url: station.streamUrl)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("1", forHTTPHeaderField: "Icy-MetaData")

    let (data, response) = try await fetch(request)
    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
        throw URLError(.badServerResponse)
    }

    guard let raw = icyStreamTitle(from: data, metaint: icyMetaint(from: http)) else {
        throw URLError(.cannotParseResponse)
    }
    return parseIcyStreamTitle(raw)
}

func fetchHlsTimedMetadata(
    station: Station,
    fetch: MetadataDataFetcher = { try await URLSession.shared.data(for: $0) },
) async throws -> NowPlayingMetadata? {
    guard isHlsPlaylistURL(station.streamUrl) else { return nil }

    var playlistRequest = URLRequest(url: station.streamUrl)
    playlistRequest.cachePolicy = .reloadIgnoringLocalCacheData
    playlistRequest.timeoutInterval = 10

    let (playlistData, playlistResponse) = try await fetch(playlistRequest)
    guard let playlistHTTP = playlistResponse as? HTTPURLResponse,
          (200...299).contains(playlistHTTP.statusCode),
          let playlist = String(data: playlistData, encoding: .utf8),
          let segmentURL = hlsTimedMetadataSegmentURL(from: playlist, playlistURL: station.streamUrl) else {
        throw URLError(.cannotParseResponse)
    }

    var segmentRequest = URLRequest(url: segmentURL)
    segmentRequest.cachePolicy = .reloadIgnoringLocalCacheData
    segmentRequest.timeoutInterval = 10
    segmentRequest.setValue("bytes=0-\(hlsTimedMetadataMaximumSegmentBytes - 1)", forHTTPHeaderField: "Range")

    let (segmentData, segmentResponse) = try await fetch(segmentRequest)
    guard let segmentHTTP = segmentResponse as? HTTPURLResponse,
          (200...299).contains(segmentHTTP.statusCode) else {
        throw URLError(.badServerResponse)
    }

    guard let metadata = parseHlsTimedMetadata(from: segmentData) else {
        throw URLError(.cannotParseResponse)
    }
    return metadata
}

func hlsTimedMetadataSegmentURL(from playlist: String, playlistURL: URL) -> URL? {
    playlist
        .split(whereSeparator: \.isNewline)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty && !$0.hasPrefix("#") }
        .compactMap { URL(string: $0, relativeTo: playlistURL)?.absoluteURL }
        .last
}

func parseHlsTimedMetadata(from data: Data) -> NowPlayingMetadata? {
    let frames = id3TextFrames(from: data)
    guard let title = frames["TIT2"] else { return nil }
    if let artist = frames["TPE1"] {
        return NowPlayingMetadata(artist: artist, title: title, raw: "\(artist) - \(title)")
    }
    return parseIcyStreamTitle(title)
}

private func readIcyStreamTitle(from bytes: URLSession.AsyncBytes, metaint: Int?) async throws -> String? {
    var iterator = bytes.makeAsyncIterator()
    var buffer = [UInt8]()

    if let metaint, metaint > 0 {
        let headerLength = metaint + 1
        while buffer.count < headerLength {
            guard let byte = try await iterator.next() else { return nil }
            buffer.append(byte)
        }

        let metadataLength = Int(buffer[metaint]) * 16
        guard metadataLength <= icyMetadataMaximumBlockBytes else { return nil }
        guard metadataLength > 0 else { return "" }

        while buffer.count < headerLength + metadataLength {
            guard let byte = try await iterator.next() else { return nil }
            buffer.append(byte)
        }

        return preciseIcyStreamTitle(from: Data(buffer), metaint: metaint)
    }

    while buffer.count < icyMetadataMaximumScanBytes {
        guard let byte = try await iterator.next() else {
            return scannedIcyStreamTitle(from: Data(buffer))
        }
        buffer.append(byte)
        if byte == UInt8(ascii: "'"),
           let title = scannedIcyStreamTitle(from: Data(buffer)) {
            return title
        }
    }

    return scannedIcyStreamTitle(from: Data(buffer))
}

private func preciseIcyStreamTitle(from data: Data, metaint: Int) -> String? {
    let bytes = [UInt8](data)
    guard bytes.count > metaint else { return nil }

    let metadataLength = Int(bytes[metaint]) * 16
    guard metadataLength <= icyMetadataMaximumBlockBytes else { return nil }
    guard metadataLength > 0 else { return "" }

    let metadataStart = metaint + 1
    let metadataEnd = metadataStart + metadataLength
    guard bytes.count >= metadataEnd else { return nil }

    let metadata = Data(bytes[metadataStart..<metadataEnd])
    return extractStreamTitle(from: decodeIcyMetadata(metadata)) ?? ""
}

private func scannedIcyStreamTitle(from data: Data) -> String? {
    let bytes = [UInt8](data.prefix(icyMetadataMaximumScanBytes))
    let marker = Array(streamTitleMarker.utf8)
    guard let markerStart = firstIndex(of: marker, in: bytes) else { return nil }

    let valueStart = markerStart + marker.count
    guard valueStart < bytes.count else { return nil }

    var valueEnd = valueStart
    while valueEnd < bytes.count, bytes[valueEnd] != UInt8(ascii: "'") {
        valueEnd += 1
    }
    guard valueEnd < bytes.count else { return nil }

    return decodeIcyMetadata(Data(bytes[valueStart..<valueEnd]))
}

private func extractStreamTitle(from metadata: String) -> String? {
    guard let markerRange = metadata.range(of: streamTitleMarker) else { return nil }
    let valueStart = markerRange.upperBound
    guard let valueEnd = metadata[valueStart...].firstIndex(of: "'") else { return nil }
    return String(metadata[valueStart..<valueEnd])
}

private func decodeIcyMetadata(_ data: Data) -> String {
    let utf8 = String(decoding: data, as: UTF8.self)
    if utf8.contains("\u{FFFD}") {
        return String(data: data, encoding: .isoLatin1) ?? utf8
    }
    return utf8
}

private func isHlsPlaylistURL(_ url: URL) -> Bool {
    url.pathExtension.lowercased() == "m3u8"
}

private func id3TextFrames(from data: Data) -> [String: String] {
    let bytes = [UInt8](data)
    var frames: [String: String] = [:]
    var searchIndex = 0

    while searchIndex + 10 <= bytes.count {
        let remaining = Array(bytes[searchIndex..<bytes.count])
        guard let relativeID3Start = firstIndex(of: id3Marker, in: remaining) else { break }
        let tagStart = searchIndex + relativeID3Start
        guard tagStart + 10 <= bytes.count else { break }

        let version = bytes[tagStart + 3]
        guard let tagSize = synchsafeInteger(bytes[(tagStart + 6)..<(tagStart + 10)]) else {
            searchIndex = tagStart + id3Marker.count
            continue
        }

        let tagEnd = min(bytes.count, tagStart + 10 + tagSize)
        var frameStart = tagStart + 10
        while frameStart + 10 <= tagEnd {
            let frameIDBytes = bytes[frameStart..<(frameStart + 4)]
            guard frameIDBytes.allSatisfy({ $0 != 0 }),
                  let frameID = String(bytes: frameIDBytes, encoding: .ascii) else {
                break
            }

            let frameSizeBytes = bytes[(frameStart + 4)..<(frameStart + 8)]
            let frameSize = version >= 4
                ? synchsafeInteger(frameSizeBytes)
                : bigEndianInteger(frameSizeBytes)
            guard let frameSize, frameSize > 0 else { break }

            let payloadStart = frameStart + 10
            let payloadEnd = payloadStart + frameSize
            guard payloadEnd <= tagEnd else { break }

            if frameID.hasPrefix("T"),
               let value = decodeID3TextFrame(Data(bytes[payloadStart..<payloadEnd])) {
                frames[frameID] = value
            }
            frameStart = payloadEnd
        }

        searchIndex = max(tagEnd, tagStart + id3Marker.count)
    }

    return frames
}

private func decodeID3TextFrame(_ data: Data) -> String? {
    guard let encoding = data.first else { return nil }
    let textData = Data(data.dropFirst())
    let decoded: String?
    switch encoding {
    case 0:
        decoded = String(data: textData, encoding: .isoLatin1)
    case 1:
        decoded = String(data: textData, encoding: .utf16)
    case 2:
        decoded = String(data: textData, encoding: .utf16BigEndian)
    case 3:
        decoded = String(data: textData, encoding: .utf8)
    default:
        decoded = String(data: textData, encoding: .utf8)
            ?? String(data: textData, encoding: .isoLatin1)
    }

    let trimmed = decoded?
        .replacingOccurrences(of: "\0", with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed?.isEmpty == false ? trimmed : nil
}

private func synchsafeInteger(_ bytes: ArraySlice<UInt8>) -> Int? {
    guard bytes.count == 4, bytes.allSatisfy({ $0 & 0x80 == 0 }) else { return nil }
    return bytes.reduce(0) { ($0 << 7) | Int($1) }
}

private func bigEndianInteger(_ bytes: ArraySlice<UInt8>) -> Int? {
    guard bytes.count == 4 else { return nil }
    return bytes.reduce(0) { ($0 << 8) | Int($1) }
}

private func icyMetaint(from response: HTTPURLResponse) -> Int? {
    for (key, value) in response.allHeaderFields {
        guard let header = key as? String, header.lowercased() == "icy-metaint" else { continue }
        if let stringValue = value as? String {
            return Int(stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if let numberValue = value as? NSNumber {
            return numberValue.intValue
        }
    }
    return nil
}

private func firstIndex(of needle: [UInt8], in haystack: [UInt8]) -> Int? {
    guard !needle.isEmpty, haystack.count >= needle.count else { return nil }

    for index in 0...(haystack.count - needle.count) {
        if Array(haystack[index..<(index + needle.count)]) == needle {
            return index
        }
    }
    return nil
}
