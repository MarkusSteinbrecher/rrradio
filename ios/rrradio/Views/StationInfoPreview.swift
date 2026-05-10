import SwiftUI

struct StationInfoPreview: View {
    let station: Station
    let nowPlaying: NowPlayingMetadata?
    let isCurrent: Bool
    let isPlaying: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            currentSection
            streamSection
            catalogSection
        }
        .padding(18)
        .frame(maxWidth: 430)
        .background(RrradioTheme.bg)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(RrradioTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.22), radius: 24, y: 16)
    }

    private var header: some View {
        HStack(spacing: 14) {
            FaviconView(url: station.favicon, stationName: station.name, stationID: station.id, size: 58)
                .frame(width: 58, height: 58)

            VStack(alignment: .leading, spacing: 7) {
                Text(station.name)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    if isPlaying {
                        infoPill("Playing")
                    } else if isCurrent {
                        infoPill("Loaded")
                    }
                    let flag = countryFlagEmoji(station.country)
                    if !flag.isEmpty {
                        flagPill(flag)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let coverUrl = nowPlaying?.coverUrl {
                NowPlayingArtworkThumb(url: coverUrl, size: 72)
                    .frame(width: 72, height: 72)
                    .layoutPriority(1)
            }
        }
    }

    private var currentSection: some View {
        infoSection("Current") {
            if let currentLine {
                infoRow("Now playing", currentLine)
            }
            if let programLine {
                infoRow("Program", programLine)
            }
        }
    }

    private var streamSection: some View {
        infoSection("Stream") {
            infoRow("Quality", streamQualityText)
            if let status = clean(station.status) {
                infoRow("Status", status)
            }
            if let listeners = station.listeners {
                infoRow("Listeners", NumberFormatter.localizedString(from: NSNumber(value: listeners), number: .decimal))
            }
        }
    }

    private var catalogSection: some View {
        infoSection("Catalog") {
            if let country = clean(station.country) {
                infoRow("Country", country)
            }
            if let tags = station.tags, !tags.isEmpty {
                infoRow("Tags", tags.prefix(8).joined(separator: ", "))
            }
            if let metadata = clean(station.metadata) {
                infoRow("Metadata", metadata)
            }
        }
    }

    private func infoSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.5)
                .foregroundStyle(RrradioTheme.ink3)
            VStack(spacing: 0) {
                content()
            }
            .background(RrradioTheme.bg2)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(title)
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 92, alignment: .leading)
            Text(value)
                .font(.system(size: 14))
                .foregroundStyle(RrradioTheme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func infoPill(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .foregroundStyle(RrradioTheme.ink2)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(RrradioTheme.bg2)
            .overlay(Capsule().stroke(RrradioTheme.line))
            .clipShape(Capsule())
    }

    private func flagPill(_ value: String) -> some View {
        Text(value)
            .font(.system(size: 13))
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(RrradioTheme.bg2)
            .overlay(Capsule().stroke(RrradioTheme.line))
            .clipShape(Capsule())
    }

    private var currentLine: String? {
        guard let title = clean(nowPlaying?.title) else { return nil }
        if let artist = clean(nowPlaying?.artist) {
            return "\(artist) - \(title)"
        }
        return title
    }

    private var programLine: String? {
        [
            clean(nowPlaying?.programName),
            clean(nowPlaying?.programSubtitle),
        ]
        .compactMap { $0 }
        .joined(separator: " . ")
        .nilIfEmpty
    }

    private var streamQualityText: String {
        let detail = [
            clean(station.codec)?.uppercased(),
            station.bitrate.map { "\($0) kbps" },
        ]
        .compactMap { $0 }
        .joined(separator: ", ")
        .nilIfEmpty ?? "Unknown codec and bitrate"
        return "\(detail), quality \(streamQualityLevel(codec: station.codec, bitrate: station.bitrate))/4"
    }

    private func clean(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
