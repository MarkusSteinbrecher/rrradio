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

    // Lives inside the Settings page-style TabView (SettingsView.swift:14).
    // SwiftUI `Form` (UICollectionView-backed) crashed during the page
    // transition's layout pass — see issue #212. ScrollView + VStack
    // matches the pattern AboutContentView and SettingsPageView use in
    // the same TabView.
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
                        TextField("Homepage", text: $homepage)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .rrradioFieldStyle()
                        TextField("Country", text: $country)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .rrradioFieldStyle()
                        TextField("Tags", text: $tags)
                            .textInputAutocapitalization(.never)
                            .rrradioFieldStyle()
                    }
                }

                Button(action: saveAndPlay) {
                    Text(locale.text(.saveAndPlay))
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(1.1)
                        .foregroundStyle(RrradioTheme.bg)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(RrradioTheme.buttonFill)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 13))
                        .foregroundStyle(.red)
                }

                if !library.customStations.isEmpty {
                    addStationSection("Your stations") {
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
                library.removeCustom(station)
            } label: {
                Image(systemName: "trash")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.red)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
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
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(LocaleController())
}
