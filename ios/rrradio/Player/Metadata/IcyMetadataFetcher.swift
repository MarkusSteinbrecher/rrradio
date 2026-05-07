import Foundation

private let icyMetadataMaximumScanBytes = 96 * 1024
private let icyMetadataMaximumBlockBytes = 255 * 16
private let streamTitleMarker = "StreamTitle='"

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
