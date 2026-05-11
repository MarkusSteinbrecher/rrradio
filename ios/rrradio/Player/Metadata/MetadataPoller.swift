import Foundation
import Observation

@Observable
@MainActor
final class MetadataPoller {
    private var timer: Timer?
    private var generation = 0

    func start(
        station: Station,
        fetcher: @escaping StationMetadataFetcher,
        interval: TimeInterval = 30,
        onUpdate: @escaping (NowPlayingMetadata?) -> Void,
    ) {
        stop()
        let myGeneration = generation

        let tick = { [weak self] in
            Task { [weak self] in
                guard let self else { return }
                do {
                    let metadata = try await fetcher(station)
                    await MainActor.run { [weak self] in
                        guard let self, self.generation == myGeneration else { return }
                        onUpdate(metadata)
                    }
                } catch {
                    await MainActor.run { [weak self] in
                        guard let self, self.generation == myGeneration else { return }
                        var details = ["station": station.name]
                        if let urlError = error as? URLError {
                            details["error"] = String(urlError.code.rawValue)
                        }
                        diagnosticRecord("metadata", "polling failed", details: details)
                    }
                }
            }
        }

        _ = tick()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] timer in
            guard self != nil else {
                timer.invalidate()
                return
            }
            _ = tick()
        }
    }

    func stop() {
        generation += 1
        timer?.invalidate()
        timer = nil
    }
}
