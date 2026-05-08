import AVFoundation
import Observation

@Observable
@MainActor
final class CarModeController {
    static let autoKey = "rrradio.carMode.automatic.v1"
    static let manualKey = "rrradio.carMode.manual.v1"

    private let defaults: UserDefaults
    private var routeObserver: NSObjectProtocol?

    private(set) var routeName = ""
    private(set) var detectedCarRoute = false
    var automaticEnabled: Bool {
        didSet { defaults.set(automaticEnabled, forKey: Self.autoKey) }
    }
    var manualEnabled: Bool {
        didSet { defaults.set(manualEnabled, forKey: Self.manualKey) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        automaticEnabled = defaults.object(forKey: Self.autoKey) as? Bool ?? true
        manualEnabled = defaults.bool(forKey: Self.manualKey)
        refreshRoute()

        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main,
        ) { [weak self] _ in
            Task { @MainActor in
                self?.refreshRoute()
            }
        }
    }

    var isActive: Bool {
        manualEnabled || (automaticEnabled && detectedCarRoute)
    }

    var routeLabel: String {
        routeName.isEmpty ? "iPhone" : routeName
    }

    func setAutomaticEnabled(_ enabled: Bool) {
        automaticEnabled = enabled
    }

    func setManualEnabled(_ enabled: Bool) {
        manualEnabled = enabled
    }

    func refreshRoute() {
        let route = AVAudioSession.sharedInstance().currentRoute
        routeName = route.outputs.map(\.portName).filter { !$0.isEmpty }.joined(separator: " + ")
        detectedCarRoute = route.outputs.contains(where: isCarLikeOutput)
    }

    private func isCarLikeOutput(_ output: AVAudioSessionPortDescription) -> Bool {
        if output.portType == .carAudio {
            return true
        }

        let name = output.portName.lowercased()
        let carHints = [
            "car", "auto", "carplay", "bmw", "mini", "mercedes", "benz",
            "audi", "vw", "volkswagen", "porsche", "skoda", "seat", "cupra",
            "tesla", "toyota", "lexus", "honda", "acura", "nissan", "infiniti",
            "mazda", "subaru", "hyundai", "kia", "ford", "lincoln", "chevrolet",
            "cadillac", "gmc", "jeep", "dodge", "ram", "volvo", "polestar",
            "renault", "peugeot", "citroen", "fiat", "alfa", "land rover",
            "range rover",
        ]

        switch output.portType {
        case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .usbAudio:
            return carHints.contains { name.contains($0) }
        default:
            return false
        }
    }
}
