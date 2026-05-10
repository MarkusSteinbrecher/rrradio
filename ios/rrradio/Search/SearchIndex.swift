import Foundation
import SQLite3
import os

private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct SearchHit: Equatable {
    let stationID: String
    let score: Double
}

enum SearchIndexError: Error {
    case unavailable
    case queryFailed(String)
}

final class SearchIndex: @unchecked Sendable {
    private let database: OpaquePointer?
    private let lock = NSLock()
    private let signpostLog = OSLog(subsystem: "org.rrradio.ios", category: "search")

    let stationCount: Int

    static func bundled(bundle: Bundle = .main) -> SearchIndex? {
        guard let url = bundle.url(forResource: "stations", withExtension: "fts5.db") else {
            diagnosticRecordAsync("search", "fts unavailable", details: ["reason": "missing bundled database"])
            return nil
        }
        do {
            return try SearchIndex(databaseURL: url)
        } catch {
            diagnosticRecordAsync("search", "fts unavailable", details: ["reason": String(describing: error)])
            return nil
        }
    }

    init(databaseURL: URL) throws {
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
        guard sqlite3_open_v2(databaseURL.path, &handle, flags, nil) == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            if let handle {
                sqlite3_close(handle)
            }
            throw SearchIndexError.queryFailed(message)
        }
        database = handle
        stationCount = Self.readStationCount(handle)
    }

    deinit {
        if let database {
            sqlite3_close(database)
        }
    }

    func search(query: String, limit: Int) throws -> [SearchHit] {
        let matchQuery = Self.matchQuery(for: query)
        guard !matchQuery.isEmpty else { return [] }
        guard let database else { throw SearchIndexError.unavailable }

        let signpostID = OSSignpostID(log: signpostLog)
        os_signpost(.begin, log: signpostLog, name: "FTS search", signpostID: signpostID)
        defer {
            os_signpost(.end, log: signpostLog, name: "FTS search", signpostID: signpostID)
        }

        lock.lock()
        defer { lock.unlock() }

        let sql = """
        SELECT stations_meta.station_id, bm25(stations_fts, 4.0, 1.0, 0.5) AS score
        FROM stations_fts
        JOIN stations_meta ON stations_meta.rowid = stations_fts.rowid
        WHERE stations_fts MATCH ?
        ORDER BY score
        LIMIT ?;
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw SearchIndexError.queryFailed(Self.errorMessage(database))
        }
        defer {
            sqlite3_finalize(statement)
        }

        sqlite3_bind_text(statement, 1, matchQuery, -1, sqliteTransient)
        sqlite3_bind_int(statement, 2, Int32(max(1, limit)))

        var hits: [SearchHit] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_ROW {
                guard let idPointer = sqlite3_column_text(statement, 0) else { continue }
                hits.append(SearchHit(
                    stationID: String(cString: idPointer),
                    score: sqlite3_column_double(statement, 1),
                ))
            } else if result == SQLITE_DONE {
                return hits
            } else {
                throw SearchIndexError.queryFailed(Self.errorMessage(database))
            }
        }
    }

    private static func readStationCount(_ database: OpaquePointer) -> Int {
        let sql = "SELECT COUNT(*) FROM stations_meta;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return 0 }
        defer {
            sqlite3_finalize(statement)
        }
        guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(statement, 0))
    }

    private static func matchQuery(for query: String) -> String {
        query
            .lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .filter { !$0.isEmpty }
            .map { "\"\($0)\"*" }
            .joined(separator: " ")
    }

    private static func errorMessage(_ database: OpaquePointer) -> String {
        String(cString: sqlite3_errmsg(database))
    }
}
