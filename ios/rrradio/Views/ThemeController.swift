import Observation
import SwiftUI

@Observable
final class ThemeController {
    enum Choice: String {
        case system
        case light
        case dark
    }

    private let defaults: UserDefaults
    private let key = "rrradio.theme"
    private(set) var choice: Choice

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        choice = defaults.string(forKey: key).flatMap(Choice.init(rawValue:)) ?? .system
    }

    var preferredColorScheme: ColorScheme? {
        switch choice {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    func toggle(effective colorScheme: ColorScheme) {
        choice = colorScheme == .dark ? .light : .dark
        defaults.set(choice.rawValue, forKey: key)
    }

    func setChoice(_ newChoice: Choice) {
        choice = newChoice
        defaults.set(newChoice.rawValue, forKey: key)
    }
}
