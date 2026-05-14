import Observation
import SwiftUI
import UIKit

@Observable
final class ThemeController {
    enum Choice: String {
        case system
        case light
        case dark
    }

    static let accentStorageKey = "rrradio.theme.accent"
    static let classicAccentRawValue = "classic"
    static let classicAccentHex = "#FFFF00"

    private let defaults: UserDefaults
    private let key = "rrradio.theme"
    private(set) var choice: Choice
    private(set) var accentRawValue: String
    private(set) var systemColorScheme: ColorScheme = .light
    @ObservationIgnored var onChange: (() -> Void)?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        choice = defaults.string(forKey: key).flatMap(Choice.init(rawValue:)) ?? .system
        accentRawValue = Self.normalizedAccentStorageValue(defaults.string(forKey: Self.accentStorageKey))
        defaults.set(accentRawValue, forKey: Self.accentStorageKey)
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
        onChange?()
    }

    func setChoice(_ newChoice: Choice) {
        choice = newChoice
        defaults.set(newChoice.rawValue, forKey: key)
        onChange?()
    }

    var accentColor: Color {
        Self.accentColor(for: accentRawValue)
    }

    var accentHexValue: String {
        Self.hexValue(for: accentRawValue) ?? Self.classicAccentHex
    }

    var hasCustomAccent: Bool {
        Self.hexValue(for: accentRawValue) != nil
    }

    func setAccentColor(_ color: Color) {
        guard let hexValue = Self.hexValue(from: color) else { return }
        setAccentRawValue(hexValue)
    }

    @discardableResult
    func setAccentHex(_ value: String) -> Bool {
        guard let normalized = Self.normalizedHexValue(value) else { return false }
        setAccentRawValue(normalized)
        return true
    }

    func resetAccent() {
        setAccentRawValue(Self.classicAccentRawValue)
    }

    private func setAccentRawValue(_ rawValue: String) {
        let normalized = Self.normalizedAccentStorageValue(rawValue)
        guard accentRawValue != normalized else { return }
        accentRawValue = normalized
        defaults.set(normalized, forKey: Self.accentStorageKey)
        onChange?()
    }

    func setSystemColorScheme(_ colorScheme: ColorScheme) {
        systemColorScheme = colorScheme
    }

    func applyCloudSync(_ newChoice: Choice) {
        choice = newChoice
        defaults.set(newChoice.rawValue, forKey: key)
    }

    func applyCloudSyncAccent(_ rawValue: String) {
        let normalized = Self.normalizedAccentStorageValue(rawValue)
        accentRawValue = normalized
        defaults.set(normalized, forKey: Self.accentStorageKey)
    }

    static func accentColor(for rawValue: String? = UserDefaults.standard.string(forKey: accentStorageKey)) -> Color {
        if let hexValue = hexValue(for: normalizedAccentStorageValue(rawValue)),
           let uiColor = uiColor(from: hexValue) {
            return Color(uiColor)
        }
        return Color(UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 1, green: 1, blue: 0, alpha: 1)
                : UIColor(red: 0, green: 0.627, blue: 0.251, alpha: 1)
        })
    }

    static func normalizedAccentStorageValue(_ rawValue: String?) -> String {
        guard let value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return classicAccentRawValue
        }
        if value.caseInsensitiveCompare(classicAccentRawValue) == .orderedSame {
            return classicAccentRawValue
        }
        if let legacyValue = legacyPresetHexValue(for: value) {
            return legacyValue
        }
        return normalizedHexValue(value) ?? classicAccentRawValue
    }

    static func isValidAccentStorageValue(_ rawValue: String?) -> Bool {
        guard let value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return false
        }
        return value.caseInsensitiveCompare(classicAccentRawValue) == .orderedSame
            || legacyPresetHexValue(for: value) != nil
            || normalizedHexValue(value) != nil
    }

    static func normalizedHexValue(_ value: String) -> String? {
        var trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if trimmed.hasPrefix("#") {
            trimmed.removeFirst()
        } else if trimmed.hasPrefix("0X") {
            trimmed.removeFirst(2)
        }
        if trimmed.count == 3 {
            trimmed = trimmed.map { "\($0)\($0)" }.joined()
        }
        guard trimmed.count == 6,
              trimmed.allSatisfy(\.isHexDigit) else {
            return nil
        }
        return "#\(trimmed)"
    }

    static func hexValue(for rawValue: String?) -> String? {
        let normalized = normalizedAccentStorageValue(rawValue)
        guard normalized != classicAccentRawValue else { return nil }
        return normalized
    }

    static func hexValue(from color: Color) -> String? {
        let uiColor = UIColor(color)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
        return String(
            format: "#%02X%02X%02X",
            Int(round(red * 255)),
            Int(round(green * 255)),
            Int(round(blue * 255)),
        )
    }

    private static func uiColor(from hexValue: String) -> UIColor? {
        guard let normalized = normalizedHexValue(hexValue) else { return nil }
        let value = String(normalized.dropFirst())
        guard let number = Int(value, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((number >> 16) & 0xFF) / 255,
            green: CGFloat((number >> 8) & 0xFF) / 255,
            blue: CGFloat(number & 0xFF) / 255,
            alpha: 1,
        )
    }

    private static func legacyPresetHexValue(for rawValue: String) -> String? {
        switch rawValue.lowercased() {
        case "blue": "#0A84FF"
        case "rose": "#FF7AA3"
        case "violet": "#AD96FF"
        default: nil
        }
    }
}
