import XCTest
@testable import rrradio

final class RadioBrowserClientTests: XCTestCase {
    override func tearDown() {
        RadioBrowserStubProtocol.handler = nil
        super.tearDown()
    }

    func testSearchSkipsInvalidStreamUrlsAndSendsUserAgent() async throws {
        var seenUserAgent: String?
        var seenHost: String?
        let body = """
        [
          { "stationuuid": "good", "name": "Good FM", "url_resolved": "https://stream.example.com/live" },
          { "stationuuid": "bad", "name": "Bad FM", "url_resolved": "not a url" }
        ]
        """.data(using: .utf8)!

        RadioBrowserStubProtocol.handler = { request in
            seenUserAgent = request.value(forHTTPHeaderField: "User-Agent")
            seenHost = request.url?.host
            return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        let stations = try await makeClient().search(query: "good")

        XCTAssertEqual(seenUserAgent, "rrradio-ios-test/1")
        XCTAssertEqual(seenHost, "de1.api.radio-browser.info")
        XCTAssertEqual(stations.map(\.id), ["rb-good"])
        XCTAssertEqual(stations.first?.streamUrl.absoluteString, "https://stream.example.com/live")
    }

    func testSearchFallsBackToNextMirrorAndCachesSuccessfulHost() async throws {
        var seenHosts: [String] = []
        RadioBrowserStubProtocol.handler = { request in
            guard let url = request.url, let host = url.host else {
                throw URLError(.badURL)
            }
            seenHosts.append(host)
            if seenHosts.count == 1 {
                return (Data(), HTTPURLResponse(url: url, statusCode: 503, httpVersion: nil, headerFields: nil)!)
            }
            let body = "[]".data(using: .utf8)!
            return (body, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        let client = makeClient()
        _ = try await client.search()
        _ = try await client.search()

        XCTAssertEqual(seenHosts, [
            "de1.api.radio-browser.info",
            "at1.api.radio-browser.info",
            "at1.api.radio-browser.info",
        ])
    }

    private func makeClient() -> RadioBrowserClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RadioBrowserStubProtocol.self]
        return RadioBrowserClient(session: URLSession(configuration: config), userAgent: "rrradio-ios-test/1")
    }
}

private final class RadioBrowserStubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Data, HTTPURLResponse))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (data, response) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
