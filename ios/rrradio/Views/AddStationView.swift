import SwiftUI

struct AddStationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleController.self) private var locale
    var onSave: (Station) -> Void = { _ in }

    var body: some View {
        NavigationStack {
            AddStationContentView { station in
                onSave(station)
                dismiss()
            }
            .navigationTitle(locale.text(.addStation))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(locale.text(.cancel)) { dismiss() }
                }
            }
        }
    }
}

struct AddStationContentView: View {
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(LocaleController.self) private var locale
    let onSave: (Station) -> Void

    @State private var name = ""
    @State private var streamURL = ""
    @State private var errorMessage: String?
    @State private var stationPendingDeletion: Station?

    // Lives inside the Settings page-style TabView (SettingsView.swift:16).
    // SwiftUI `Form` (UICollectionView-backed) crashed during the page
    // transition's layout pass when swiping About → Add Station — see
    // issue #212. ScrollView + VStack matches the pattern AboutContentView
    // and SettingsPageView use in the same TabView.
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(locale.text(.addStation))
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                }

                addStationSection("Station") {
                    VStack(spacing: 10) {
                        TextField("Name", text: $name)
                            .textInputAutocapitalization(.words)
                            .rrradioFieldStyle()
                        TextField("Stream URL", text: $streamURL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .rrradioFieldStyle()
                    }
                }

                Button(action: saveAndPlay) {
                    Text(duplicateStations.isEmpty ? locale.text(.saveAndPlay) : locale.text(.saveAnyway))
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(1.1)
                        .foregroundStyle(RrradioTheme.bg)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(RrradioTheme.buttonFill)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)

                if !duplicateStations.isEmpty {
                    addStationSection("Already in rrradio") {
                        VStack(spacing: 0) {
                            ForEach(duplicateStations.prefix(4)) { station in
                                duplicateRow(station)
                            }
                        }
                        .background(RrradioTheme.bg2)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 13))
                        .foregroundStyle(.red)
                }

                if !library.customStations.isEmpty {
                    addStationSection("Added stations") {
                        VStack(spacing: 0) {
                            ForEach(library.customStations) { station in
                                customStationRow(station)
                            }
                        }
                        .background(RrradioTheme.bg2)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .font(.system(size: 14))
            .foregroundStyle(RrradioTheme.ink2)
            .padding(.horizontal, 24)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
        .confirmationDialog(
            "Delete added station?",
            isPresented: Binding(
                get: { stationPendingDeletion != nil },
                set: { presented in
                    if !presented {
                        stationPendingDeletion = nil
                    }
                },
            ),
            titleVisibility: .visible,
        ) {
            Button("Delete", role: .destructive) {
                if let station = stationPendingDeletion {
                    library.removeCustom(station)
                }
                stationPendingDeletion = nil
            }
            Button(locale.text(.cancel), role: .cancel) {
                stationPendingDeletion = nil
            }
        } message: {
            if let station = stationPendingDeletion {
                Text("Remove \(station.name) from added stations and favorites?")
            }
        }
    }

    private func duplicateRow(_ station: Station) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(station.name)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(RrradioTheme.ink)
            Text(station.streamUrl.absoluteString)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink3)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func customStationRow(_ station: Station) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(station.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                Text(station.streamUrl.host() ?? station.streamUrl.absoluteString)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .lineLimit(1)
            }
            Spacer()
            Button {
                stationPendingDeletion = station
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.red)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delete \(station.name)")
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func addStationSection<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content,
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.4)
                .foregroundStyle(RrradioTheme.ink3)
            content()
        }
    }

    private func saveAndPlay() {
        do {
            let station = try makeCustomStation(
                name: name,
                streamURL: streamURL,
            )
            let catalogMatches = matchingCatalogStations(for: station.streamUrl)
            let stationToOpen = catalogMatches.first ?? station

            library.addCustom(station, favorite: catalogMatches.isEmpty)
            catalogMatches.forEach { library.addFavorite($0) }
            player.play(stationToOpen)
            onSave(stationToOpen)
        } catch let error as CustomStationValidationError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Could not save this station."
        }
    }

    private var duplicateStations: [Station] {
        guard let url = enteredStreamURL else { return [] }
        let knownStations = catalog.browseOrdered + library.customStations + library.favorites + library.recents
        var seen: Set<String> = []
        return knownStations.filter { station in
            let key = station.id
            guard streamURLsMatch(url, station.streamUrl), !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }

    private func matchingCatalogStations(for url: URL) -> [Station] {
        catalog.browseOrdered.filter { streamURLsMatch(url, $0.streamUrl) }
    }

    private var enteredStreamURL: URL? {
        let value = streamURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }
        return url
    }
}

extension View {
    fileprivate func rrradioFieldStyle() -> some View {
        self
            .font(.system(size: 14))
            .foregroundStyle(RrradioTheme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(RrradioTheme.bg)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

#Preview {
    AddStationView()
        .environment(Catalog())
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(LocaleController())
}
