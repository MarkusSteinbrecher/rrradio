import SwiftUI

struct StationListView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(AudioPlayer.self) private var player
    @State private var query: String = ""

    var body: some View {
        Group {
            switch catalog.state {
            case .idle, .loading:
                if catalog.stations.isEmpty {
                    ProgressView("Loading catalog…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    list
                }
            case .loaded:
                list
            case .failed(let message):
                ContentUnavailableView(
                    "Catalog unavailable",
                    systemImage: "antenna.radiowaves.left.and.right.slash",
                    description: Text(message)
                )
            }
        }
        .searchable(text: $query, prompt: "Search stations")
    }

    private var filtered: [Station] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return catalog.browseOrdered }
        // Mirror the web's whitespace-insensitive matcher (src/main.ts).
        let qNorm = normalizeForSearch(q)
        return catalog.browseOrdered.filter { s in
            if s.name.lowercased().contains(q) { return true }
            if (s.tags ?? []).contains(where: { $0.lowercased().contains(q) }) { return true }
            if let cc = s.country?.lowercased(), cc.contains(q) { return true }
            if !qNorm.isEmpty && normalizeForSearch(s.name).contains(qNorm) { return true }
            return false
        }
    }

    private var list: some View {
        List(filtered) { station in
            Button {
                player.play(station)
            } label: {
                StationRow(station: station, isCurrent: player.current?.id == station.id)
            }
            .listRowSeparator(.hidden)
        }
        .listStyle(.plain)
    }
}

struct StationRow: View {
    let station: Station
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            FaviconView(url: station.favicon)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(station.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                    if let cc = station.country {
                        Text(cc.uppercased())
                            .font(.caption2.monospaced())
                            .foregroundStyle(.tertiary)
                    }
                }
                if let tags = station.tags, !tags.isEmpty {
                    Text(tags.prefix(3).joined(separator: " · "))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            if isCurrent {
                Image(systemName: "waveform")
                    .foregroundStyle(.tint)
                    .symbolEffect(.variableColor.iterative, options: .repeating)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}

struct FaviconView: View {
    let url: URL?
    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let img): img.resizable().aspectRatio(contentMode: .fit)
            default: Color.secondary.opacity(0.15)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// Whitespace-insensitive search normalizer — keeps a–z, 0–9, and the
/// German diacritics, drops everything else. Mirrors the web's
/// `normalizeForSearch` in src/main.ts so "WDR5" matches "WDR 5".
private func normalizeForSearch(_ s: String) -> String {
    s.lowercased().filter { ch in
        ch.isLetter || ch.isNumber || ch == "ä" || ch == "ö" || ch == "ü" || ch == "ß"
    }
}
