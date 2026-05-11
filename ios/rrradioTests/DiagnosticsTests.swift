import XCTest
@testable import rrradio

@MainActor
final class DiagnosticsTests: XCTestCase {
    func testDiagnosticsSanitizeUrlDetails() {
        let suiteName = "org.rrradio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let diagnostics = Diagnostics(defaults: defaults)
        diagnostics.isEnabled = true

        diagnostics.record("report", "broken", details: [
            "stream": "https://example.com/live.mp3?token=secret",
        ])

        XCTAssertEqual(diagnostics.events.first?.details["stream"], "example.com")
        XCTAssertFalse(diagnostics.exportText().contains("token=secret"))
        XCTAssertFalse(diagnostics.exportText().contains("example.com"))
    }

    func testDiagnosticsExportRedactsListeningIdentifiersButKeepsLocalSummary() {
        let suiteName = "org.rrradio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let diagnostics = Diagnostics(defaults: defaults)
        diagnostics.isEnabled = true

        diagnostics.record("playback", "failed", details: [
            "station": "Test FM",
            "stationID": "abc123",
            "streamHost": "stream.example.com",
            "count": "2",
            "error": "failed loading https://stream.example.com/live?token=secret",
        ])

        XCTAssertTrue(diagnostics.recentSummary.contains("Test FM"))
        XCTAssertTrue(diagnostics.recentSummary.contains("stream.example.com"))

        let export = diagnostics.exportText()
        XCTAssertTrue(export.contains("[playback] failed"))
        XCTAssertTrue(export.contains("count=2"))
        XCTAssertFalse(export.contains("Test FM"))
        XCTAssertFalse(export.contains("abc123"))
        XCTAssertFalse(export.contains("stream.example.com"))
        XCTAssertFalse(export.contains("token=secret"))
    }

    func testDiagnosticsKeepOnlyRecentHundredEvents() {
        let suiteName = "org.rrradio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let diagnostics = Diagnostics(defaults: defaults)
        diagnostics.isEnabled = true

        for index in 0..<120 {
            diagnostics.record("event", "number", details: ["index": "\(index)"])
        }

        XCTAssertEqual(diagnostics.events.count, 100)
        XCTAssertEqual(diagnostics.events.first?.details["index"], "20")
        XCTAssertEqual(diagnostics.events.last?.details["index"], "119")
    }

    func testDiagnosticsAreOffByDefault() {
        let suiteName = "org.rrradio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let diagnostics = Diagnostics(defaults: defaults)

        diagnostics.record("app", "launch")

        XCTAssertFalse(diagnostics.isEnabled)
        XCTAssertEqual(diagnostics.events.count, 0)
        XCTAssertEqual(diagnostics.recentSummary, "Diagnostics collection is off.")
    }

    func testDisablingDiagnosticsClearsLocalEvents() {
        let suiteName = "org.rrradio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let diagnostics = Diagnostics(defaults: defaults)
        diagnostics.isEnabled = true
        diagnostics.record("app", "launch")

        diagnostics.isEnabled = false

        XCTAssertEqual(diagnostics.events.count, 0)
        XCTAssertNil(defaults.data(forKey: "rrradio.diagnostics.events.v1"))
    }
}
