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
    let stationIDs: Set<String>

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
        stationIDs = Self.readStationIDs(handle)
    }

    deinit {
        if let database {
            sqlite3_close(database)
        }
    }

    func search(query: String, limit: Int) throws -> [SearchHit] {
        let matchQuery = Self.matchQuery(for: query)
        guard !matchQuery.isEmpty else { return [] }
        let compactQuery = Self.compactSearchText(query)
        let requestedLimit = max(1, limit)
        let fetchLimit = max(requestedLimit, min(500, requestedLimit + 50))
        guard let database else { throw SearchIndexError.unavailable }

        let signpostID = OSSignpostID(log: signpostLog)
        os_signpost(.begin, log: signpostLog, name: "FTS search", signpostID: signpostID)
        defer {
            os_signpost(.end, log: signpostLog, name: "FTS search", signpostID: signpostID)
        }

        lock.lock()
        defer { lock.unlock() }

        let sql = """
        SELECT stations_meta.station_id, stations_fts.name, bm25(stations_fts, 4.0, 1.0, 0.5, 0.25) AS score
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
        sqlite3_bind_int(statement, 2, Int32(fetchLimit))

        var hits: [RankedSearchHit] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_ROW {
                guard let idPointer = sqlite3_column_text(statement, 0) else { continue }
                guard let namePointer = sqlite3_column_text(statement, 1) else { continue }
                hits.append(RankedSearchHit(
                    stationID: String(cString: idPointer),
                    name: String(cString: namePointer),
                    score: sqlite3_column_double(statement, 2),
                ))
            } else if result == SQLITE_DONE {
                return hits
                    .sorted { lhs, rhs in
                        let lhsTier = Self.nameMatchTier(name: lhs.name, compactQuery: compactQuery)
                        let rhsTier = Self.nameMatchTier(name: rhs.name, compactQuery: compactQuery)
                        if lhsTier != rhsTier { return lhsTier < rhsTier }
                        if lhs.score != rhs.score { return lhs.score < rhs.score }
                        return lhs.stationID.localizedCaseInsensitiveCompare(rhs.stationID) == .orderedAscending
                    }
                    .prefix(requestedLimit)
                    .map { SearchHit(stationID: $0.stationID, score: $0.score) }
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

    private static func readStationIDs(_ database: OpaquePointer) -> Set<String> {
        let sql = "SELECT station_id FROM stations_meta;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return [] }
        defer {
            sqlite3_finalize(statement)
        }

        var ids = Set<String>()
        while sqlite3_step(statement) == SQLITE_ROW {
            guard let idPointer = sqlite3_column_text(statement, 0) else { continue }
            ids.insert(String(cString: idPointer))
        }
        return ids
    }

    private static func matchQuery(for query: String) -> String {
        let tokens = searchTokens(for: query).filter { !$0.isEmpty }
        guard !tokens.isEmpty else { return "" }

        let splitQuery = tokens
            .map { "\"\($0)\"*" }
            .joined(separator: " ")
        guard tokens.count > 1 else { return splitQuery }

        let compactQuery = tokens.joined()
        return "\(splitQuery) OR \"\(compactQuery)\"*"
    }

    private static func searchTokens(for query: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var currentKind: CharacterKind?

        for character in query.lowercased() {
            guard let kind = CharacterKind(character) else {
                if !current.isEmpty {
                    tokens.append(current)
                    current = ""
                    currentKind = nil
                }
                continue
            }

            if currentKind == kind {
                current.append(character)
            } else {
                if !current.isEmpty {
                    tokens.append(current)
                }
                current = String(character)
                currentKind = kind
            }
        }

        if !current.isEmpty {
            tokens.append(current)
        }
        return tokens
    }

    private static func compactSearchText(_ text: String) -> String {
        searchTokens(for: text).joined()
    }

    private static func nameMatchTier(name: String, compactQuery: String) -> Int {
        guard !compactQuery.isEmpty else { return 3 }
        let compactName = compactSearchText(name)
        if compactName == compactQuery { return 0 }
        if compactName.hasPrefix(compactQuery) { return 1 }
        if compactName.contains(compactQuery) { return 2 }
        return 3
    }

    private struct RankedSearchHit {
        let stationID: String
        let name: String
        let score: Double
    }

    private enum CharacterKind {
        case letter
        case number

        init?(_ character: Character) {
            if character.isLetter {
                self = .letter
            } else if character.isNumber {
                self = .number
            } else {
                return nil
            }
        }
    }

    private static func errorMessage(_ database: OpaquePointer) -> String {
        String(cString: sqlite3_errmsg(database))
    }
}
