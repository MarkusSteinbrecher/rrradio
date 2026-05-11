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
                    await MainActor.run {
                        guard self.generation == myGeneration else { return }
                        onUpdate(metadata)
                    }
                } catch {
                    await MainActor.run {
                        guard self.generation == myGeneration else { return }
                        diagnosticRecord("metadata", "polling failed", details: ["station": station.name, "error": error.localizedDescription])
                    }
                }
            }
        }

        _ = tick()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            guard self != nil else { return }
            _ = tick()
        }
    }

    func stop() {
        generation += 1
        timer?.invalidate()
        timer = nil
    }
}
