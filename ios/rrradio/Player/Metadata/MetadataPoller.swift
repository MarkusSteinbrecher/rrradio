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

        let tick = {
            Task {
                do {
                    let metadata = try await fetcher(station)
                    await MainActor.run {
                        guard self.generation == myGeneration else { return }
                        onUpdate(metadata)
                    }
                } catch {
                    await MainActor.run {
                        guard self.generation == myGeneration else { return }
                        self.stop()
                    }
                }
            }
        }

        _ = tick()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            _ = tick()
        }
    }

    func stop() {
        generation += 1
        timer?.invalidate()
        timer = nil
    }
}
