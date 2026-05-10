import XCTest
@testable import rrradio

@MainActor
final class ListeningHistoryTests: XCTestCase {
    private var temporaryFiles: [URL] = []

    override func tearDown() {
        for url in temporaryFiles {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryFiles = []
        super.tearDown()
    }

    func testRetentionRemovesClosedRecordsOutsideWindow() {
        let history = makeHistory()
        history.isEnabled = true
        history.retention = .days30

        let oldStation = station(id: "old", name: "Old Station", country: "DE")
        let currentStation = station(id: "current", name: "Current Station", country: "CH")
        let oldStart = Calendar.current.date(byAdding: .day, value: -40, to: Date())!
        let currentStart = Calendar.current.date(byAdding: .day, value: -2, to: Date())!

        history.startSession(for: oldStation, at: oldStart)
        history.closeActiveSession(at: oldStart.addingTimeInterval(600))
        history.startSession(for: currentStation, at: currentStart)
        history.closeActiveSession(at: currentStart.addingTimeInterval(900))

        XCTAssertEqual(history.records.map(\.stationID), ["current"])
        XCTAssertEqual(history.summary().sessionCount, 1)
        XCTAssertEqual(history.summary().totalSeconds, 900)
    }

    func testRaceSnapshotsBuildCumulativeRankingAndShares() {
        let history = makeHistory()
        history.isEnabled = true
        history.retention = .forever

        let calendar = Calendar(identifier: .gregorian)
        let day1 = calendar.date(from: DateComponents(year: 2026, month: 1, day: 1, hour: 9))!
        let day2 = calendar.date(from: DateComponents(year: 2026, month: 1, day: 2, hour: 9))!
        let alpha = station(id: "alpha", name: "Alpha", country: "AT")
        let beta = station(id: "beta", name: "Beta", country: "CH")

        history.startSession(for: alpha, at: day1)
        history.closeActiveSession(at: day1.addingTimeInterval(30 * 60))
        history.startSession(for: beta, at: day1.addingTimeInterval(60 * 60))
        history.closeActiveSession(at: day1.addingTimeInterval(70 * 60))
        history.startSession(for: beta, at: day2)
        history.closeActiveSession(at: day2.addingTimeInterval(40 * 60))

        let snapshots = history.raceSnapshots(maxStations: 10)

        XCTAssertEqual(snapshots.count, 2)
        XCTAssertEqual(snapshots[0].entries.map(\.stationID), ["alpha", "beta"])
        XCTAssertEqual(snapshots[0].entries.map(\.rank), [1, 2])
        XCTAssertEqual(snapshots[1].entries.map(\.stationID), ["beta", "alpha"])
        XCTAssertEqual(snapshots[1].entries.map(\.rank), [1, 2])
        XCTAssertEqual(snapshots[1].entries[0].totalSeconds, 50 * 60, accuracy: 0.1)
        XCTAssertEqual(snapshots[1].entries[0].share, 50.0 / 80.0, accuracy: 0.001)
    }

    func testRaceSnapshotsClampLongDateRanges() {
        let history = makeHistory()
        history.isEnabled = true
        history.retention = .forever

        let calendar = Calendar(identifier: .gregorian)
        let oldStart = calendar.date(from: DateComponents(year: 2020, month: 1, day: 1, hour: 9))!
        let recentStart = calendar.date(from: DateComponents(year: 2026, month: 1, day: 1, hour: 9))!
        let oldStation = station(id: "old", name: "Old Station", country: "DE")
        let recentStation = station(id: "recent", name: "Recent Station", country: "CH")

        history.startSession(for: oldStation, at: oldStart)
        history.closeActiveSession(at: oldStart.addingTimeInterval(60 * 60))
        history.startSession(for: recentStation, at: recentStart)
        history.closeActiveSession(at: recentStart.addingTimeInterval(30 * 60))

        let snapshots = history.raceSnapshots(maxStations: 10)

        XCTAssertLessThanOrEqual(snapshots.count, 366)
        XCTAssertEqual(snapshots.last?.entries.map(\.stationID), ["old", "recent"])
    }

    func testExportCSVQuotesFieldsAndSortsNewestFirst() {
        let history = makeHistory()
        history.isEnabled = true
        history.level = .tracks
        history.retention = .forever

        let olderStart = Date(timeIntervalSince1970: 1_700_000_000)
        let newerStart = olderStart.addingTimeInterval(3600)
        let quoted = station(id: "quoted", name: "Radio \"Quoted\"", country: "US")
        let comma = station(id: "comma", name: "Comma, FM", country: "GB")

        history.startSession(for: quoted, at: olderStart)
        history.updateCurrentTrack(artist: "Artist \"A\"", title: "Title, One")
        history.closeActiveSession(at: olderStart.addingTimeInterval(120))
        history.startSession(for: comma, at: newerStart)
        history.closeActiveSession(at: newerStart.addingTimeInterval(60))

        let rows = history.exportCSV().split(separator: "\n").map(String.init)

        XCTAssertEqual(rows.count, 3)
        XCTAssertTrue(rows[1].contains("\"comma\""))
        XCTAssertTrue(rows[1].contains("\"Comma, FM\""))
        XCTAssertTrue(rows[2].contains("\"Radio \"\"Quoted\"\"\""))
        XCTAssertTrue(rows[2].contains("\"Artist \"\"A\"\"\""))
        XCTAssertTrue(rows[2].contains("\"Title, One\""))
    }

    private func makeHistory() -> ListeningHistory {
        let suiteName = "org.rrradio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let url = FileManager.default.temporaryDirectory
            .appending(path: "rrradio-listening-history-\(UUID().uuidString).json")
        temporaryFiles.append(url)
        return ListeningHistory(defaults: defaults, recordsURL: url)
    }

    private func station(id: String, name: String, country: String?) -> Station {
        Station(
            id: id,
            name: name,
            streamUrl: URL(string: "https://example.com/\(id).mp3")!,
            country: country,
        )
    }
}
