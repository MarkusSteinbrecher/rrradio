import AppIntents

struct PlayStationIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Station"
    static var description = IntentDescription("Play a chosen rrradio station.")
    static var openAppWhenRun = true

    @Parameter(title: "Station")
    var station: StationEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Play \(\.$station)")
    }

    func perform() async throws -> some IntentResult {
        IntentPlaybackRequest.requestPlay(stationID: station.id)
        return .result()
    }
}

struct PlayLastStationIntent: AppIntent {
    static var title: LocalizedStringResource = "Play Last Station"
    static var description = IntentDescription("Play the most recently played rrradio station.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        IntentPlaybackRequest.requestPlayLastStation()
        return .result()
    }
}

struct RrradioShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlayLastStationIntent(),
            phrases: [
                "Play last station in \(.applicationName)",
                "Start \(.applicationName)",
            ],
            shortTitle: "Play Last Station",
            systemImageName: "radio",
        )
        AppShortcut(
            intent: PlayStationIntent(),
            phrases: [
                "Play \(\.$station) in \(.applicationName)",
            ],
            shortTitle: "Play Station",
            systemImageName: "dot.radiowaves.left.and.right",
        )
    }
}
