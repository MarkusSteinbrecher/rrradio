import Foundation
import Observation
import UIKit

@Observable
@MainActor
final class Diagnostics {
    static let shared = Diagnostics()

    struct Event: Codable, Identifiable {
        let id: UUID
        let timestamp: Date
        let category: String
        let message: String
        let details: [String: String]
    }

    private enum Constants {
        static let storageKey = "rrradio.diagnostics.events.v1"
        static let maxEvents = 200
    }

    private let defaults: UserDefaults
    private(set) var events: [Event] = []

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        events = Self.readEvents(from: defaults)
    }

    func record(_ category: String, _ message: String, details: [String: String] = [:]) {
        let cleanDetails = details.reduce(into: [String: String]()) { result, item in
            let key = item.key.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = item.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty, !value.isEmpty {
                result[key] = value
            }
        }
        events.append(Event(id: UUID(), timestamp: Date(), category: category, message: message, details: cleanDetails))
        if events.count > Constants.maxEvents {
            events.removeFirst(events.count - Constants.maxEvents)
        }
        persist()
    }

    func clear() {
        events = []
        defaults.removeObject(forKey: Constants.storageKey)
    }

    func exportText() -> String {
        var lines = [
            "rrradio diagnostics",
            "generated: \(Self.timestampFormatter.string(from: Date()))",
            "app: \(Self.appVersion)",
            "device: \(UIDevice.current.model) \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
            "locale: \(Locale.current.identifier)",
            "",
            "events:",
        ]

        if events.isEmpty {
            lines.append("- none")
        } else {
            lines.append(contentsOf: events.map(Self.format))
        }
        return lines.joined(separator: "\n")
    }

    var recentSummary: String {
        if events.isEmpty { return "No diagnostic events yet." }
        return events.suffix(6).map(Self.format).joined(separator: "\n")
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(events) else { return }
        defaults.set(data, forKey: Constants.storageKey)
    }

    private static func readEvents(from defaults: UserDefaults) -> [Event] {
        guard let data = defaults.data(forKey: Constants.storageKey),
              let events = try? JSONDecoder().decode([Event].self, from: data) else {
            return []
        }
        return Array(events.suffix(Constants.maxEvents))
    }

    private static func format(_ event: Event) -> String {
        let detailText = event.details
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: " ")
        let suffix = detailText.isEmpty ? "" : " \(detailText)"
        return "- \(timestampFormatter.string(from: event.timestamp)) [\(event.category)] \(event.message)\(suffix)"
    }

    private static let timestampFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = info?["CFBundleVersion"] as? String ?? "unknown"
        return "\(version) (\(build))"
    }
}

@MainActor
func diagnosticRecord(_ category: String, _ message: String, details: [String: String] = [:]) {
    Diagnostics.shared.record(category, message, details: details)
}

func diagnosticRecordAsync(_ category: String, _ message: String, details: [String: String] = [:]) {
    Task { @MainActor in
        Diagnostics.shared.record(category, message, details: details)
    }
}

struct BrokenStationReporter {
    private static let endpoint = URL(string: "https://rrradio-stats.markussteinbrecher.workers.dev/api/public/report-broken")!

    static func report(station: Station, playbackState: AudioPlayer.State) async throws {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "stationId": station.id,
            "stationName": station.name,
            "streamUrl": station.streamUrl.absoluteString,
            "platform": "ios",
            "appVersion": appVersion,
            "reason": playbackReason(playbackState),
            "source": "manual",
        ])

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }

    private static func playbackReason(_ state: AudioPlayer.State) -> String {
        if case let .error(message) = state {
            return String(message.prefix(160))
        }
        return ""
    }

    private static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
        let build = info?["CFBundleVersion"] as? String ?? "unknown"
        return "\(version) (\(build))"
    }
}
