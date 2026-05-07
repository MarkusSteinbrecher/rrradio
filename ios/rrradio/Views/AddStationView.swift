import SwiftUI

struct AddStationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleController.self) private var locale

    var body: some View {
        NavigationStack {
            AddStationContentView {
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
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(LocaleController.self) private var locale
    let onSave: () -> Void

    @State private var name = ""
    @State private var streamURL = ""
    @State private var homepage = ""
    @State private var country = ""
    @State private var tags = ""
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name)
                    .textInputAutocapitalization(.words)
                TextField("Stream URL", text: $streamURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Homepage", text: $homepage)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Country", text: $country)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                TextField("Tags", text: $tags)
                    .textInputAutocapitalization(.never)
            }

            Section {
                Button(locale.text(.saveAndPlay)) { saveAndPlay() }
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
                    .foregroundStyle(RrradioTheme.bg)
                    .frame(maxWidth: .infinity, minHeight: 38)
                    .background(RrradioTheme.buttonFill)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .listRowBackground(Color.clear)
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }

            if !library.customStations.isEmpty {
                Section("Your stations") {
                    ForEach(library.customStations) { station in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(station.name)
                                Text(station.streamUrl.host() ?? station.streamUrl.absoluteString)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(role: .destructive) {
                                library.removeCustom(station)
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(RrradioTheme.bg)
    }

    private func saveAndPlay() {
        do {
            let station = try makeCustomStation(
                name: name,
                streamURL: streamURL,
                homepage: homepage,
                country: country,
                tags: tags,
            )
            library.addCustom(station)
            library.pushRecent(station)
            player.play(station)
            onSave()
        } catch let error as CustomStationValidationError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Could not save this station."
        }
    }
}

#Preview {
    AddStationView()
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(LocaleController())
}
