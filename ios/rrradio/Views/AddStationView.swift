import SwiftUI

struct AddStationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleController.self) private var locale

    var body: some View {
        NavigationStack {
            AddStationContentView()
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
    @Environment(\.openURL) private var openURL
    @Environment(Catalog.self) private var catalog
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(LocaleController.self) private var locale

    @State private var name = ""
    @State private var streamURL = ""
    @State private var errorMessage: String?
    @State private var streamURLNoticeMessage: String?
    @State private var upgradedHTTPStreamURL: String?
    @State private var shouldHighlightNameField = false
    @State private var stationBeingEdited: Station?
    @State private var stationPendingDeletion: Station?
    @State private var savedStationSignature: String?
    @State private var streamCheckTask: Task<Void, Never>?
    @State private var streamCheckState = StreamCheckState.idle

    var body: some View {
        Form {
            Section {
                TextField(text: $name, prompt: Text("Name").foregroundStyle(namePromptColor)) {
                    Text("Name")
                }
                    .textInputAutocapitalization(.words)
                TextField(text: $streamURL, prompt: Text("https://").foregroundStyle(RrradioTheme.ink4)) {
                    Text("Stream URL")
                }
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if streamCheckState.showsStatusMessage {
                    streamCheckStatusView
                }
                if let streamURLNoticeMessage {
                    streamURLNoticeView(streamURLNoticeMessage)
                }
                if hasEnteredFormData {
                    addStationControlsRow
                }
            }

            if !catalogDuplicateStations.isEmpty {
                Section("Already in catalog") {
                    ForEach(catalogDuplicateStations.prefix(4)) { station in
                        catalogDuplicateRow(station)
                    }
                }
            }

            if canSendCatalogSubmission {
                Section {
                    Button {
                        sendCatalogSubmission()
                    } label: {
                        Label("Send to rrradio.org catalog", systemImage: "paperplane")
                            .frame(maxWidth: .infinity)
                    }
                } footer: {
                    Text("Opens Mail with a prefilled catalog request. Your configured Mail account sends it; rrradio cannot read your iCloud email address.")
                }
            }

            if catalogDuplicateStations.isEmpty, !duplicateStations.isEmpty {
                Section("Already added") {
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
                    ForEach(Array(library.customStations.enumerated()), id: \.element.id) { index, station in
                        addedStationRow(station, showsTopSeparator: index > 0)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(RrradioTheme.bg)
        .onChange(of: streamURL) { _, nextValue in
            savedStationSignature = nil
            scheduleStreamCheck(for: nextValue)
        }
        .onChange(of: name) { _, nextValue in
            savedStationSignature = nil
            if !nextValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                shouldHighlightNameField = false
            }
        }
        .onDisappear {
            streamCheckTask?.cancel()
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

    private var streamCheckStatusView: some View {
        HStack(spacing: 8) {
            switch streamCheckState {
            case .idle:
                EmptyView()
            case .checking:
                ProgressView()
                    .controlSize(.small)
                Text("Checking stream...")
                    .foregroundStyle(RrradioTheme.ink3)
            case .playable:
                EmptyView()
            case let .failed(message):
                Text(message)
                    .foregroundStyle(.red)
            }
        }
        .font(.caption)
        .listRowBackground(Color.clear)
    }

    private func streamURLNoticeView(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill")
            Text(message)
        }
        .font(.caption)
        .foregroundStyle(RrradioTheme.ink3)
        .listRowBackground(Color.clear)
    }

    private var addStationControlsRow: some View {
        HStack(alignment: .center) {
            Button("Clear") {
                clearForm()
            }
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.1)
            .foregroundStyle(RrradioTheme.ink2)
            .frame(width: 82, height: 38)
            .background(RrradioTheme.bg3)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .buttonStyle(.plain)

            Spacer(minLength: 14)

            testStreamButton

            Spacer(minLength: 14)

            Button(saveButtonLabel) {
                saveStation()
            }
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.1)
            .foregroundStyle(canSaveCurrentForm ? RrradioTheme.bg : RrradioTheme.ink3)
            .frame(width: 82, height: 38)
            .background(saveButtonBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .disabled(!canSaveCurrentForm)
            .scaleEffect(isCurrentFormSaved ? 0.96 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.72), value: isCurrentFormSaved)
            .buttonStyle(.plain)
        }
        .padding(.vertical, 6)
        .listRowBackground(Color.clear)
    }

    private var testStreamButton: some View {
        Button {
            testStream()
        } label: {
            ZStack {
                Circle()
                    .fill(streamCheckState.canSave ? RrradioTheme.accent : RrradioTheme.bg3)
                    .shadow(color: streamCheckState.canSave ? RrradioTheme.accent.opacity(0.18) : .clear, radius: 20)
                Image(systemName: isTestingEnteredStream ? "pause.fill" : "play.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(streamCheckState.canSave ? RrradioTheme.bg : RrradioTheme.ink4)
                    .offset(x: isTestingEnteredStream ? 0 : 3)
            }
            .frame(width: 92, height: 92)
        }
        .disabled(!streamCheckState.canSave)
        .buttonStyle(.plain)
        .accessibilityLabel(isTestingEnteredStream ? locale.text(.pause) : locale.text(.play))
    }

    private func saveStation() {
        guard streamCheckState.canSave else {
            errorMessage = "Check the stream URL before saving."
            return
        }

        do {
            let station = try makeCustomStation(
                name: name,
                streamURL: streamURL,
                id: stationBeingEdited?.id ?? "custom-\(UUID().uuidString)",
            )
            library.addCustom(station, favorite: true)
            stationBeingEdited = station
            savedStationSignature = currentStationSignature
        } catch let error as CustomStationValidationError {
            if error == .missingName {
                shouldHighlightNameField = true
                errorMessage = nil
            } else {
                errorMessage = error.localizedDescription
            }
        } catch {
            errorMessage = "Could not save this station."
        }
    }

    private func addCatalogStationToFavorites(_ station: Station) {
        library.addFavorite(station)
    }

    private func testStream() {
        guard streamCheckState.canSave else {
            errorMessage = "Check the stream URL before testing."
            return
        }

        if isCurrentTestStream {
            switch player.state {
            case .playing, .paused, .error:
                player.toggle()
            case .loading:
                player.stop()
            case .idle:
                break
            }
            return
        }

        do {
            let testName = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let station = try makeCustomStation(
                name: testName.isEmpty ? "Test station" : testName,
                streamURL: streamURL,
                id: "custom-test-\(UUID().uuidString)",
            )
            player.play(station)
        } catch let error as CustomStationValidationError {
            errorMessage = error.localizedDescription
        } catch {
            errorMessage = "Could not test this station."
        }
    }

    private var isCurrentTestStream: Bool {
        guard let current = player.current,
              current.id.hasPrefix("custom-test-"),
              let url = enteredStreamURL else {
            return false
        }
        return streamURLsMatch(url, current.streamUrl)
    }

    private var isTestingEnteredStream: Bool {
        guard isCurrentTestStream else { return false }
        return player.state == .loading || player.state == .playing
    }

    private func sendCatalogSubmission() {
        guard let url = catalogSubmissionMailURL(name: name, streamURL: streamURL) else {
            errorMessage = "Enter a valid stream URL before sending."
            return
        }
        openURL(url)
    }

    private func clearForm() {
        streamCheckTask?.cancel()
        name = ""
        streamURL = ""
        errorMessage = nil
        streamURLNoticeMessage = nil
        upgradedHTTPStreamURL = nil
        shouldHighlightNameField = false
        stationBeingEdited = nil
        savedStationSignature = nil
        streamCheckState = .idle
    }

    private func editCustomStation(_ station: Station) {
        streamCheckTask?.cancel()
        stationBeingEdited = station
        name = station.name
        streamURL = station.streamUrl.absoluteString
        errorMessage = nil
        streamURLNoticeMessage = nil
        upgradedHTTPStreamURL = nil
        shouldHighlightNameField = false
        savedStationSignature = currentStationSignature(name: station.name, streamURL: station.streamUrl.absoluteString)
        streamCheckState = .playable
    }

    private func scheduleStreamCheck(for rawURL: String) {
        streamCheckTask?.cancel()
        errorMessage = nil

        let value = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            streamCheckState = .idle
            streamURLNoticeMessage = nil
            upgradedHTTPStreamURL = nil
            return
        }

        if upgradedHTTPStreamURL != value {
            streamURLNoticeMessage = nil
            upgradedHTTPStreamURL = nil
        }

        streamCheckState = .checking
        streamCheckTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(450))
                try Task.checkCancellation()
                let normalizedValue = normalizedHTTPSStreamURLString(value)
                if normalizedValue != value {
                    let showsUpgradeNotice = shouldShowHTTPSUpgradeNotice(for: value)
                    await MainActor.run {
                        if showsUpgradeNotice {
                            upgradedHTTPStreamURL = normalizedValue
                            streamURLNoticeMessage = "Saved and tested as https://. If this stream only supports http://, it may not play."
                            diagnosticRecord("add-station", "stream URL upgraded to HTTPS", details: ["sourceScheme": "http"])
                        }
                        streamURL = normalizedValue
                    }
                    return
                }
                guard let url = URL(string: normalizedValue),
                      let scheme = url.scheme?.lowercased(),
                      scheme == "https",
                      url.host != nil else {
                    await MainActor.run {
                        streamCheckState = .failed(CustomStationValidationError.invalidStreamURL.localizedDescription)
                    }
                    return
                }
                try await probeStreamURL(url)
                try Task.checkCancellation()
                await MainActor.run {
                    streamCheckState = .playable
                }
            } catch is CancellationError {
                return
            } catch {
                await MainActor.run {
                    streamCheckState = .failed((error as? LocalizedError)?.errorDescription ?? "Could not reach this stream.")
                }
            }
        }
    }

    private var duplicateStations: [Station] {
        guard let url = enteredStreamURL else { return [] }
        let knownStations = library.customStations + library.favorites + library.recents
        var seen: Set<String> = []
        return knownStations.filter { station in
            let key = station.id
            if key == stationBeingEdited?.id { return false }
            guard streamURLsMatch(url, station.streamUrl), !seen.contains(key) else { return false }
            seen.insert(key)
            return true
        }
    }

    private var catalogDuplicateStations: [Station] {
        guard let url = enteredStreamURL else { return [] }
        return matchingCatalogStations(for: url)
    }

    private var hasKnownDuplicate: Bool {
        !catalogDuplicateStations.isEmpty || !duplicateStations.isEmpty
    }

    private var canSendCatalogSubmission: Bool {
        streamCheckState.canSave && catalogDuplicateStations.isEmpty
    }

    private var canSaveCurrentForm: Bool {
        streamCheckState.canSave && !isCurrentFormSaved
    }

    private var isCurrentFormSaved: Bool {
        savedStationSignature == currentStationSignature
    }

    private var saveButtonLabel: String {
        isCurrentFormSaved ? "Saved" : "Save"
    }

    private var saveButtonBackground: Color {
        canSaveCurrentForm ? RrradioTheme.buttonFill : RrradioTheme.bg3
    }

    private var currentStationSignature: String {
        currentStationSignature(name: name, streamURL: streamURL)
    }

    private func currentStationSignature(name: String, streamURL: String) -> String {
        [
            stationBeingEdited?.id ?? "",
            name.trimmingCharacters(in: .whitespacesAndNewlines),
            normalizedHTTPSStreamURLString(streamURL),
        ].joined(separator: "\u{1f}")
    }

    private var hasEnteredFormData: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !streamURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var namePromptColor: Color {
        shouldHighlightNameField ? .red : RrradioTheme.ink4
    }

    private func addedStationRow(_ station: Station, showsTopSeparator: Bool) -> some View {
        HStack(spacing: 12) {
            LocalStationArtworkView(size: 34)
            VStack(alignment: .leading, spacing: 4) {
                Text(station.name)
                    .foregroundStyle(RrradioTheme.ink)
                Text(station.streamUrl.host() ?? station.streamUrl.absoluteString)
                    .font(.caption.monospaced())
                    .foregroundStyle(RrradioTheme.ink3)
                    .lineLimit(1)
            }
            Spacer()
            Button {
                editCustomStation(station)
            } label: {
                Image(systemName: "pencil")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Edit \(station.name)")
            Button(role: .destructive) {
                stationPendingDeletion = station
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Delete \(station.name)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .overlay(alignment: .top) {
            if showsTopSeparator {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }
        }
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
    }

    private func catalogDuplicateRow(_ station: Station) -> some View {
        VStack(spacing: 10) {
            StationRow(
                station: station,
                isCurrent: player.current?.id == station.id,
                isPlaying: player.current?.id == station.id && player.state == .playing,
                isFavorite: library.isFavorite(station),
                isCustom: library.isCustom(station),
                onPlay: {
                    player.play(station)
                },
                onToggleFavorite: {
                    addCatalogStationToFavorites(station)
                },
                showsFavoriteButton: true,
            )
            .background(RrradioTheme.bg)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(RrradioTheme.line))
        }
        .padding(.vertical, 6)
        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
        .listRowBackground(Color.clear)
    }

    private func matchingCatalogStations(for url: URL) -> [Station] {
        stationsMatchingStreamURL(url, in: catalog.browseOrdered)
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

private enum StreamCheckState: Equatable {
    case idle
    case checking
    case playable
    case failed(String)

    var canSave: Bool {
        self == .playable
    }

    var showsStatusMessage: Bool {
        switch self {
        case .checking, .failed:
            return true
        case .idle, .playable:
            return false
        }
    }
}

func catalogSubmissionMailURL(name rawName: String, streamURL rawStreamURL: String) -> URL? {
    let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
    let streamURL = normalizedHTTPSStreamURLString(rawStreamURL.trimmingCharacters(in: .whitespacesAndNewlines))
    guard !streamURL.isEmpty else { return nil }

    let subject = "rrradio catalog station request"
    let body = """
    Please consider adding this station to the rrradio.org catalog.

    Name: \(name.isEmpty ? "(not provided)" : name)
    Stream URL: \(streamURL)

    Notes:
    """

    var components = URLComponents()
    components.scheme = "mailto"
    components.path = "redsukramst@gmail.com"
    components.queryItems = [
        URLQueryItem(name: "subject", value: subject),
        URLQueryItem(name: "body", value: body),
    ]
    return components.url
}

func normalizedHTTPSStreamURLString(_ raw: String) -> String {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return value }

    if value.lowercased().hasPrefix("https://") || value.lowercased().hasPrefix("http://") {
        var remainder = value
        while true {
            let lowercasedRemainder = remainder.lowercased()
            if lowercasedRemainder.hasPrefix("https://") {
                remainder = String(remainder.dropFirst("https://".count))
            } else if lowercasedRemainder.hasPrefix("http://") {
                remainder = String(remainder.dropFirst("http://".count))
            } else {
                break
            }
        }
        return "https://\(remainder)"
    }
    if value.contains("://") {
        return value
    }
    return "https://\(value)"
}

func shouldShowHTTPSUpgradeNotice(for raw: String) -> Bool {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.lowercased().hasPrefix("http://") &&
        normalizedHTTPSStreamURLString(value) != value
}

#Preview {
    AddStationView()
        .environment(Catalog())
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(LocaleController())
}
