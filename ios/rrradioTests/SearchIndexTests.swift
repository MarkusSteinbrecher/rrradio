import SQLite3
import XCTest
@testable import rrradio

final class SearchIndexTests: XCTestCase {
    func testSearchIsDiacriticInsensitive() throws {
        let index = try makeIndex(stations: [
            station(id: "es", name: "Radio Español", tags: ["latin", "noticias"], country: "ES"),
        ])

        XCTAssertEqual(try index.search(query: "espanol", limit: 10).map(\.stationID), ["es"])
    }

    func testNameMatchesRankAheadOfTagMatches() throws {
        let index = try makeIndex(stations: [
            station(id: "tag", name: "City FM", tags: ["jazz"], country: "US"),
            station(id: "name", name: "Jazz Radio", tags: ["music"], country: "US"),
        ])

        XCTAssertEqual(try index.search(query: "jazz", limit: 10).map(\.stationID).first, "name")
    }

    func testMixedLetterNumberQueryMatchesSeparatedTokens() throws {
        let index = try makeIndex(stations: [
            station(id: "wdr5", name: "WDR 5", tags: ["news"], country: "DE"),
        ])

        XCTAssertEqual(try index.search(query: "wdr5", limit: 10).map(\.stationID), ["wdr5"])
    }

    func testLimitIsApplied() throws {
        let index = try makeIndex(stations: [
            station(id: "one", name: "Rock One"),
            station(id: "two", name: "Rock Two"),
        ])

        XCTAssertEqual(try index.search(query: "rock", limit: 1).count, 1)
    }

    private func station(
        id: String,
        name: String,
        tags: [String]? = nil,
        country: String? = nil,
    ) -> Station {
        Station(
            id: id,
            name: name,
            streamUrl: URL(string: "https://example.com/\(id)")!,
            country: country,
            tags: tags,
        )
    }

    private func makeIndex(stations: [Station]) throws -> SearchIndex {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("db")
        var database: OpaquePointer?
        XCTAssertEqual(sqlite3_open(url.path, &database), SQLITE_OK)
        guard let database else {
            throw SearchIndexError.unavailable
        }
        try exec(
            database,
            "CREATE VIRTUAL TABLE stations_fts USING fts5(name, tags, country, tokenize='unicode61 remove_diacritics 2');",
        )
        try exec(
            database,
            "CREATE TABLE stations_meta(rowid INTEGER PRIMARY KEY, station_id TEXT NOT NULL UNIQUE, has_logo INTEGER NOT NULL, recents_rank_hint INTEGER NOT NULL);",
        )
        try exec(database, "BEGIN;")
        for (index, station) in stations.enumerated() {
            let rowid = index + 1
            let tags = station.tags?.joined(separator: " ") ?? ""
            try exec(database, "INSERT INTO stations_fts(rowid, name, tags, country) VALUES(\(rowid), \(sql(station.name)), \(sql(tags)), \(sql(station.country ?? "")));")
            try exec(database, "INSERT INTO stations_meta(rowid, station_id, has_logo, recents_rank_hint) VALUES(\(rowid), \(sql(station.id)), 0, \(index));")
        }
        try exec(database, "COMMIT;")
        sqlite3_close(database)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: url)
        }
        return try SearchIndex(databaseURL: url)
    }

    private func exec(_ database: OpaquePointer, _ sql: String) throws {
        var error: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(database, sql, nil, nil, &error)
        if result != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? "sqlite error \(result)"
            sqlite3_free(error)
            throw SearchIndexError.queryFailed(message)
        }
    }

    private func sql(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "''"))'"
    }
}
