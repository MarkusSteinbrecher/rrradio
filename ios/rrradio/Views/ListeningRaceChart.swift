import SwiftUI

struct ListeningRaceChart: View {
    let snapshots: [ListeningHistoryRaceSnapshot]
    let stations: [Station]

    @State private var selectedIndex = 0
    @State private var isPlaying = false
    @State private var playbackPosition: Double = 0

    private let playbackTimer = Timer.publish(every: 0.08, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if snapshots.isEmpty {
                Text("No listening history in this range yet.")
                    .font(.system(size: 14))
                    .foregroundStyle(RrradioTheme.ink3)
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                raceControls
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 8) {
                        ForEach(1...10, id: \.self) { rank in
                            Text("\(rank)")
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundStyle(RrradioTheme.ink3)
                                .frame(width: 20, height: 46, alignment: .trailing)
                        }
                    }

                    VStack(spacing: 8) {
                        ForEach(currentEntries, id: \.stationID) { entry in
                            ListeningRaceRow(
                                entry: entry,
                                station: station(for: entry),
                                maxSeconds: currentMaxSeconds,
                            )
                            .id(entry.stationID)
                        }

                        ForEach(0..<emptyRowCount, id: \.self) { _ in
                            Color.clear
                                .frame(height: 46)
                        }
                    }
                }
                .animation(.snappy(duration: 0.55), value: currentEntries.map(\.stationID))
            }
        }
        .padding(14)
        .onReceive(playbackTimer) { _ in
            guard isPlaying, !snapshots.isEmpty else { return }
            if playbackPosition >= Double(snapshots.count - 1) {
                isPlaying = false
                playbackPosition = Double(snapshots.count - 1)
                selectedIndex = snapshots.count - 1
            } else {
                let nextPosition = min(Double(snapshots.count - 1), playbackPosition + playbackStep)
                withAnimation(.linear(duration: 0.08)) {
                    playbackPosition = nextPosition
                }
                selectedIndex = Int(nextPosition.rounded())
            }
        }
        .onAppear {
            selectedIndex = max(snapshots.count - 1, 0)
            playbackPosition = Double(selectedIndex)
        }
        .onChange(of: snapshots.map(\.id)) { _, _ in
            selectedIndex = max(snapshots.count - 1, 0)
            playbackPosition = Double(selectedIndex)
            isPlaying = false
        }
    }

    private var currentSnapshot: ListeningHistoryRaceSnapshot {
        snapshots[min(max(selectedIndex, 0), snapshots.count - 1)]
    }

    private var currentEntries: [ListeningHistoryRaceEntry] {
        guard !snapshots.isEmpty else { return [] }
        let lowerIndex = min(max(Int(floor(playbackPosition)), 0), snapshots.count - 1)
        let upperIndex = min(lowerIndex + 1, snapshots.count - 1)
        let progress = playbackPosition - Double(lowerIndex)
        guard lowerIndex != upperIndex, progress > 0 else {
            return snapshots[lowerIndex].entries
        }

        let lowerEntries = Dictionary(uniqueKeysWithValues: snapshots[lowerIndex].entries.map { ($0.rank, $0) })
        let upperEntries = Dictionary(uniqueKeysWithValues: snapshots[upperIndex].entries.map { ($0.rank, $0) })

        return (1...10).compactMap { rank in
            guard let upper = upperEntries[rank] ?? lowerEntries[rank] else { return nil }
            let lower = lowerEntries[rank]
            return ListeningHistoryRaceEntry(
                stationID: upper.stationID,
                stationName: upper.stationName,
                country: upper.country,
                totalSeconds: interpolate(from: lower?.totalSeconds ?? 0, to: upper.totalSeconds, progress: progress),
                rank: rank,
                share: interpolate(from: lower?.share ?? 0, to: upper.share, progress: progress),
            )
        }
    }

    private var currentMaxSeconds: TimeInterval {
        max(currentEntries.map(\.totalSeconds).max() ?? 0, 1)
    }

    private var emptyRowCount: Int {
        max(0, 10 - currentEntries.count)
    }

    private func station(for entry: ListeningHistoryRaceEntry) -> Station? {
        return stations.first { $0.id == entry.stationID }
    }

    private var playbackStep: Double {
        guard snapshots.count > 1 else { return 1 }
        let targetDuration = min(54, max(18, Double(snapshots.count) * 0.11))
        return Double(snapshots.count - 1) * 0.08 / targetDuration
    }

    private func interpolate(from start: Double, to end: Double, progress: Double) -> Double {
        start + ((end - start) * progress)
    }

    private var raceControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(snapshots.first?.date.formatted(date: .abbreviated, time: .omitted) ?? "")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    if isPlaying {
                        isPlaying = false
                    } else {
                        if selectedIndex >= snapshots.count - 1 {
                            selectedIndex = 0
                            playbackPosition = 0
                        }
                        isPlaying = true
                    }
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 11, weight: .semibold))
                        Text(isPlaying ? "Pause" : "Play")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(RrradioTheme.bg)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(Capsule().fill(RrradioTheme.buttonFill))
                }
                .buttonStyle(.plain)

                Text(snapshots.last?.date.formatted(date: .abbreviated, time: .omitted) ?? "")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }

            Slider(
                value: Binding(
                    get: { Double(selectedIndex) },
                    set: { value in
                        isPlaying = false
                        selectedIndex = min(max(Int(value.rounded()), 0), snapshots.count - 1)
                        playbackPosition = Double(selectedIndex)
                    },
                ),
                in: 0...Double(max(snapshots.count - 1, 0)),
                step: 1,
            )
            .tint(RrradioTheme.accent)

            Text(currentSnapshot.date.formatted(date: .abbreviated, time: .omitted))
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }
}

private struct ListeningRaceRow: View {
    let entry: ListeningHistoryRaceEntry
    let station: Station?
    let maxSeconds: TimeInterval

    var body: some View {
        HStack(spacing: 10) {
            FaviconView(
                url: station?.favicon,
                stationName: entry.stationName,
                stationID: entry.stationID,
                size: 38,
            )
            .frame(width: 38, height: 38)

            GeometryReader { proxy in
                let minutesWidth: CGFloat = 54
                let barAreaWidth = max(0, proxy.size.width - minutesWidth - 8)
                let seconds = entry.totalSeconds
                let rawWidth = barAreaWidth * CGFloat(seconds / maxSeconds)
                let barWidth = min(barAreaWidth, max(118, rawWidth))
                HStack(spacing: 8) {
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(RrradioTheme.line.opacity(0.8))
                            .frame(height: 26)
                        Capsule()
                            .fill(RrradioTheme.accent)
                            .frame(width: barWidth, height: 26)
                        HStack(spacing: 6) {
                            Text(entry.stationName)
                                .font(.system(size: 11, weight: .semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Text(countryFlagEmoji(entry.country))
                                .font(.system(size: 10))
                            Spacer(minLength: 4)
                            Text(percentText(entry.share))
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                        }
                        .foregroundStyle(RrradioTheme.bg)
                        .padding(.horizontal, 9)
                        .frame(width: barWidth, height: 26)
                    }

                    Text(minutesText(seconds))
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(1)
                        .frame(width: minutesWidth, alignment: .trailing)
                }
            }
            .frame(height: 26)
        }
        .frame(minHeight: 46)
    }

    private func minutesText(_ seconds: TimeInterval) -> String {
        "\(minutesValue(seconds).formatted())m"
    }

    private func percentText(_ share: Double) -> String {
        "\(percentValue(share))%"
    }

    private func minutesValue(_ seconds: TimeInterval) -> Int {
        Int(seconds / 60)
    }

    private func percentValue(_ share: Double) -> Int {
        Int((share * 100).rounded())
    }
}
