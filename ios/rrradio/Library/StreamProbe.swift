import Foundation

enum StreamProbeError: LocalizedError, Equatable {
    case badStatus(Int)
    case notAudioStream
    case unsafeURL
    case networkUnavailable

    var errorDescription: String? {
        switch self {
        case let .badStatus(status):
            return "Stream check failed with HTTP \(status)."
        case .notAudioStream:
            return "This URL does not look like a live audio stream."
        case .unsafeURL:
            return "Use a public HTTPS stream URL."
        case .networkUnavailable:
            return "Could not reach this stream."
        }
    }
}

typealias StreamProbeHeaderFetcher = (URLRequest) async throws -> URLResponse

func probeStreamURL(
    _ url: URL,
    fetchHeaders: @escaping StreamProbeHeaderFetcher = { request in
        let (_, response) = try await StreamProbeSession.shared.bytes(for: request)
        return response
    },
) async throws {
    guard isPublicHTTPSStreamURL(url) else {
        throw StreamProbeError.unsafeURL
    }

    var request = URLRequest(url: url)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.timeoutInterval = 8
    request.setValue("1", forHTTPHeaderField: "Icy-MetaData")
    request.setValue("bytes=0-1", forHTTPHeaderField: "Range")

    do {
        let response = try await fetchHeaders(request)
        guard let http = response as? HTTPURLResponse else {
            throw StreamProbeError.networkUnavailable
        }
        guard let responseURL = http.url, isPublicHTTPSStreamURL(responseURL) else {
            throw StreamProbeError.unsafeURL
        }
        guard (200...299).contains(http.statusCode) else {
            throw StreamProbeError.badStatus(http.statusCode)
        }
        guard responseLooksLikeAudioStream(http) else {
            throw StreamProbeError.notAudioStream
        }
    } catch let error as StreamProbeError {
        throw error
    } catch {
        throw StreamProbeError.networkUnavailable
    }
}

func responseLooksLikeAudioStream(_ response: HTTPURLResponse) -> Bool {
    if response.value(forHTTPHeaderField: "icy-name") != nil ||
        response.value(forHTTPHeaderField: "icy-metaint") != nil ||
        response.value(forHTTPHeaderField: "icy-br") != nil {
        return true
    }

    let contentType = response.value(forHTTPHeaderField: "Content-Type")?
        .split(separator: ";", maxSplits: 1)
        .first?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()

    guard let contentType else { return false }

    if contentType.hasPrefix("audio/") { return true }

    return [
        "application/ogg",
        "application/octet-stream",
        "binary/octet-stream",
        "video/mp2t",
        "application/vnd.apple.mpegurl",
        "application/x-mpegurl",
        "audio/x-mpegurl",
    ].contains(contentType)
}

func isPublicHTTPSStreamURL(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "https",
          let host = url.host(percentEncoded: false)?.trimmingCharacters(in: .whitespacesAndNewlines),
          !host.isEmpty else {
        return false
    }

    let normalizedHost = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
    if normalizedHost == "localhost" || normalizedHost.hasSuffix(".localhost") || normalizedHost.hasSuffix(".local") {
        return false
    }
    if normalizedHost.range(of: ".") == nil && normalizedHost.range(of: ":") == nil {
        return false
    }
    if let address = IPv4Address(normalizedHost) {
        return !address.isPrivateOrLocal
    }
    if let address = IPv6Address(normalizedHost) {
        return !address.isPrivateOrLocal
    }
    return true
}

private final class StreamProbeSessionDelegate: NSObject, URLSessionTaskDelegate {
    private let maximumRedirects = 3
    private var redirectCounts: [Int: Int] = [:]
    private let lock = NSLock()

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void,
    ) {
        lock.lock()
        let nextCount = (redirectCounts[task.taskIdentifier] ?? 0) + 1
        redirectCounts[task.taskIdentifier] = nextCount
        lock.unlock()

        guard nextCount <= maximumRedirects,
              let url = request.url,
              isPublicHTTPSStreamURL(url) else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        redirectCounts[task.taskIdentifier] = nil
        lock.unlock()
    }
}

private enum StreamProbeSession {
    static let shared: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 8
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration, delegate: StreamProbeSessionDelegate(), delegateQueue: nil)
    }()
}

private struct IPv4Address: Equatable {
    let octets: [UInt8]

    init?(_ raw: String) {
        let parts = raw.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        let octets = parts.compactMap { UInt8($0) }
        guard octets.count == 4 else { return nil }
        self.octets = octets
    }

    var isPrivateOrLocal: Bool {
        let first = octets[0]
        let second = octets[1]

        if first == 10 { return true }
        if first == 127 { return true }
        if first == 169 && second == 254 { return true }
        if first == 172 && (16...31).contains(second) { return true }
        if first == 192 && second == 168 { return true }
        if first == 0 { return true }
        return false
    }
}

private struct IPv6Address: Equatable {
    private let value: String

    init?(_ raw: String) {
        guard raw.contains(":") else { return nil }
        self.value = raw.lowercased()
    }

    var isPrivateOrLocal: Bool {
        value == "::1" ||
            value.hasPrefix("fe80:") ||
            value.hasPrefix("fc") ||
            value.hasPrefix("fd")
    }
}
