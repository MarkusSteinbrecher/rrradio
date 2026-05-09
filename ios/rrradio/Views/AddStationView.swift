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

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name)
                    .textInputAutocapitalization(.words)
                TextField("Stream URL", text: $streamURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section {
                Button(duplicateStations.isEmpty ? locale.text(.saveAndPlay) : locale.text(.saveAnyway)) {
                    saveAndPlay()
                }
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
                    .foregroundStyle(RrradioTheme.bg)
                    .frame(maxWidth: .infinity, minHeight: 38)
                    .background(RrradioTheme.buttonFill)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .listRowBackground(Color.clear)
            }

            if !duplicateStations.isEmpty {
                Section("Already in rrradio") {
                    ForEach(duplicateStations.prefix(4)) { station in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(station.name)
                                .font(.body)
                                .foregroundStyle(RrradioTheme.ink)
                            Text(station.streamUrl.absoluteString)
                                .font(.caption.monospaced())
                                .foregroundStyle(RrradioTheme.ink3)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }

            if !library.customStations.isEmpty {
                Section("Added stations") {
                    ForEach(library.customStations) { station in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(station.name)
                                    .foregroundStyle(RrradioTheme.ink)
                                Text(station.streamUrl.host() ?? station.streamUrl.absoluteString)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(RrradioTheme.ink3)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Button(role: .destructive) {
                                stationPendingDeletion = station
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Delete \(station.name)")
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(RrradioTheme.bg)
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

#Preview {
    AddStationView()
        .environment(Catalog())
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(LocaleController())
}
