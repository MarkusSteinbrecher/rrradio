import XCTest
@testable import rrradio

final class StreamProbeTests: XCTestCase {
    private let url = URL(string: "https://example.com/live")!

    private func response(status: Int = 200, headers: [String: String] = [:]) -> HTTPURLResponse {
        HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    }

    func testAcceptsAudioContentType() async throws {
        try await probeStreamURL(url) { request in
            XCTAssertEqual(request.url, self.url)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Icy-MetaData"), "1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Range"), "bytes=0-1")
            return self.response(headers: ["Content-Type": "audio/mpeg"])
        }
    }

    func testAcceptsIcyStreamHeadersWithoutContentType() async throws {
        try await probeStreamURL(url) { _ in
            self.response(headers: ["icy-name": "Test FM"])
        }
    }

    func testRejectsNonSuccessStatus() async throws {
        do {
            try await probeStreamURL(url) { _ in self.response(status: 404, headers: ["Content-Type": "audio/mpeg"]) }
            XCTFail("Expected HTTP status failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .badStatus(404))
        }
    }

    func testRejectsHTMLResponse() async throws {
        do {
            try await probeStreamURL(url) { _ in self.response(headers: ["Content-Type": "text/html"]) }
            XCTFail("Expected not-audio failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .notAudioStream)
        }
    }

    func testNetworkErrorsBecomeReachabilityFailure() async throws {
        do {
            try await probeStreamURL(url) { _ in throw URLError(.notConnectedToInternet) }
            XCTFail("Expected network failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .networkUnavailable)
        }
    }

    func testRejectsNonHTTPSBeforeNetworkRequest() async throws {
        let url = URL(string: "http://example.com/live")!
        do {
            try await probeStreamURL(url) { _ in
                XCTFail("Unsafe URLs should not be requested")
                return self.response(headers: ["Content-Type": "audio/mpeg"])
            }
            XCTFail("Expected unsafe URL failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .unsafeURL)
        }
    }

    func testRejectsLocalhostBeforeNetworkRequest() async throws {
        let url = URL(string: "https://localhost/live")!
        do {
            try await probeStreamURL(url) { _ in
                XCTFail("Local URLs should not be requested")
                return self.response(headers: ["Content-Type": "audio/mpeg"])
            }
            XCTFail("Expected unsafe URL failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .unsafeURL)
        }
    }

    func testRejectsPrivateIPv4BeforeNetworkRequest() async throws {
        let url = URL(string: "https://192.168.1.1/live")!
        do {
            try await probeStreamURL(url) { _ in
                XCTFail("Private IP URLs should not be requested")
                return self.response(headers: ["Content-Type": "audio/mpeg"])
            }
            XCTFail("Expected unsafe URL failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .unsafeURL)
        }
    }

    func testRejectsRedirectToUnsafeURL() async throws {
        let redirectedURL = URL(string: "https://127.0.0.1/live")!
        do {
            try await probeStreamURL(url) { _ in
                HTTPURLResponse(
                    url: redirectedURL,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "audio/mpeg"],
                )!
            }
            XCTFail("Expected unsafe URL failure")
        } catch let error as StreamProbeError {
            XCTAssertEqual(error, .unsafeURL)
        }
    }
}
