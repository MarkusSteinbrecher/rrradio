import Foundation
import Network
import Observation

struct NetworkSnapshot: Equatable {
    enum Status: Equatable {
        case satisfied
        case requiresConnection
        case unsatisfied
        case unknown
    }

    enum Interface: Hashable {
        case cellular
        case wifi
        case wiredEthernet
        case loopback
        case other
    }

    var status: Status
    var isExpensive: Bool
    var isConstrained: Bool
    var interfaces: Set<Interface>

    static let unknown = NetworkSnapshot(
        status: .unknown,
        isExpensive: false,
        isConstrained: false,
        interfaces: [],
    )

    var isOffline: Bool {
        status == .unsatisfied || status == .requiresConnection
    }

    var primaryInterface: Interface? {
        for candidate in [Interface.wifi, .cellular, .wiredEthernet, .loopback, .other] where interfaces.contains(candidate) {
            return candidate
        }
        return nil
    }

    var shortLabel: String? {
        switch status {
        case .unsatisfied:
            return "No internet connection"
        case .requiresConnection:
            return "Connection required"
        case .satisfied where isConstrained:
            return "Low Data Mode"
        case .satisfied, .unknown:
            return nil
        }
    }

    func detail(isReconnecting: Bool) -> String? {
        if isReconnecting {
            return "Stream stopped while the connection is unavailable."
        }

        switch status {
        case .unsatisfied:
            return "Streams and catalog updates are offline."
        case .requiresConnection:
            return "Open Wi-Fi or cellular settings to finish connecting."
        case .satisfied where isConstrained:
            return "Artwork and metadata may update less often."
        case .satisfied, .unknown:
            return nil
        }
    }
}

@Observable
@MainActor
final class NetworkMonitor {
    private(set) var snapshot: NetworkSnapshot

    @ObservationIgnored private let monitor: NWPathMonitor?
    @ObservationIgnored private let queue = DispatchQueue(label: "org.rrradio.network-monitor")

    init(snapshot: NetworkSnapshot = .unknown, startsAutomatically: Bool = true) {
        self.snapshot = snapshot

        guard startsAutomatically else {
            monitor = nil
            return
        }

        let monitor = NWPathMonitor()
        self.monitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let snapshot = NetworkSnapshot(path: path)
            Task { @MainActor in
                self?.apply(snapshot)
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor?.cancel()
    }

    func apply(_ snapshot: NetworkSnapshot) {
        self.snapshot = snapshot
    }
}

private extension NetworkSnapshot {
    init(path: NWPath) {
        status = switch path.status {
        case .satisfied: .satisfied
        case .requiresConnection: .requiresConnection
        case .unsatisfied: .unsatisfied
        @unknown default: .unknown
        }
        isExpensive = path.isExpensive
        isConstrained = path.isConstrained

        var interfaces = Set<Interface>()
        if path.usesInterfaceType(.wifi) { interfaces.insert(.wifi) }
        if path.usesInterfaceType(.cellular) { interfaces.insert(.cellular) }
        if path.usesInterfaceType(.wiredEthernet) { interfaces.insert(.wiredEthernet) }
        if path.usesInterfaceType(.loopback) { interfaces.insert(.loopback) }
        if path.usesInterfaceType(.other) { interfaces.insert(.other) }
        self.interfaces = interfaces
    }
}
