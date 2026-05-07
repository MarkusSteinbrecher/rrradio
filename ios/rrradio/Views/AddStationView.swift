import SwiftUI

struct AddStationView: View {
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var streamURL = ""
    @State private var homepage = ""
    @State private var country = ""
    @State private var tags = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
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
            .navigationTitle("Add station")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save & Play") { saveAndPlay() }
                }
            }
        }
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
            dismiss()
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
}
