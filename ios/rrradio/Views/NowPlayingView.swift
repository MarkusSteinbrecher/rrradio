import SwiftUI

/// Full-screen player surface opened from the mini player.
struct NowPlayingView: View {
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detailsOpen = false
    @State private var pane: Pane = .now

    private enum Pane {
        case now
        case program
        case lyrics
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            topPanel

            ScrollView {
                paneContent
                    .padding(.horizontal, 24)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(spacing: 0) {
                controlsBlock
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 14)
                detailsBlock
                    .padding(.horizontal, 24)
            }
            .background(RrradioTheme.bg)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            bottomStrip
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    private var header: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink2)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss now playing")

            Spacer()

            Text("Now Playing")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(RrradioTheme.ink3)
                .tracking(2)

            Spacer()
                .frame(width: 40, height: 40)
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
    }

    private var topPanel: some View {
        VStack(spacing: 18) {
            stationBlock
            paneTabs
        }
        .padding(.horizontal, 24)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .background(RrradioTheme.bg)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private var stationBlock: some View {
        VStack(spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                FaviconView(
                    url: player.current?.favicon,
                    stationName: player.current?.name ?? "",
                    stationID: player.current?.id ?? "",
                )
                .frame(width: 38, height: 38)
                .layoutPriority(1)

                Text(player.current?.name ?? "")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .minimumScaleFactor(0.62)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .center)

            Text(tagLine)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .textCase(.lowercase)
                .foregroundStyle(RrradioTheme.ink3)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 6)
    }

    @ViewBuilder
    private var paneContent: some View {
        if pane == .program && hasProgram {
            programBlock
        } else if pane == .lyrics && hasLyrics {
            lyricsBlock
        } else {
            trackBlock
        }
    }

    private var trackBlock: some View {
        VStack(spacing: 14) {
            ArtworkView(
                url: player.nowPlayingCoverUrl ?? player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
            )
            .frame(width: 220, height: 220)

            VStack(spacing: 6) {
                Text(trackTitle)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.72)
                Text(trackSubtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(RrradioTheme.ink3)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }

            musicServiceButtons
        }
    }

    @ViewBuilder
    private var paneTabs: some View {
        if hasProgram || hasLyrics {
            HStack(spacing: 8) {
                paneButton("music.note", title: "Now", pane: .now)
                if hasProgram {
                    paneButton("calendar", title: programTabTitle, pane: .program)
                }
                if hasLyrics {
                    paneButton("text.quote", title: "Lyrics", pane: .lyrics)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var programBlock: some View {
        VStack(spacing: 16) {
            VStack(spacing: 7) {
                Text(player.nowPlayingProgramName ?? "Program")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.72)
                if let subtitle = clean(player.nowPlayingProgramSubtitle) {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(RrradioTheme.ink3)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
            }

            if player.isScheduleLoading && currentScheduleBroadcasts.isEmpty {
                ProgressView()
                    .tint(RrradioTheme.accent)
                    .frame(height: 88)
            } else if currentScheduleBroadcasts.isEmpty {
                Text("No schedule available")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(RrradioTheme.ink4)
                    .frame(height: 88)
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Text("Today")
                        Spacer()
                        Text("\(currentScheduleBroadcasts.count) broadcasts")
                    }
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(RrradioTheme.ink4)
                    .padding(.bottom, 8)

                    ForEach(currentScheduleBroadcasts) { broadcast in
                        programRow(broadcast)
                    }
                }
            }
        }
    }

    private func programRow(_ broadcast: ProgramScheduleBroadcast) -> some View {
        let live = isLive(broadcast)
        return HStack(alignment: .top, spacing: 12) {
            Text(timeString(broadcast.start))
                .font(.system(size: 11, weight: live ? .semibold : .medium, design: .monospaced))
                .foregroundStyle(live ? RrradioTheme.accent : RrradioTheme.ink4)
                .frame(width: 48, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                Text(broadcast.title)
                    .font(.system(size: 14, weight: live ? .semibold : .medium))
                    .foregroundStyle(live ? RrradioTheme.ink : RrradioTheme.ink2)
                    .lineLimit(2)
                if let subtitle = clean(broadcast.subtitle) {
                    Text(subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(RrradioTheme.ink4)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if live {
                Text("Live")
                    .font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(RrradioTheme.bg)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(RrradioTheme.accent))
            }
        }
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func paneButton(_ icon: String, title: String, pane target: Pane) -> some View {
        Button {
            withAnimation(.snappy) {
                pane = target
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: icon)
                Text(title)
                    .lineLimit(1)
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(pane == target ? RrradioTheme.bg : RrradioTheme.ink3)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .background(pane == target ? RrradioTheme.ink : .clear)
            .overlay(Capsule().stroke(pane == target ? RrradioTheme.ink : RrradioTheme.line))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var musicServiceButtons: some View {
        let links = musicServiceLinks(artist: player.nowPlayingArtist, title: player.nowPlayingTitle)
        if !links.isEmpty {
            HStack(spacing: 12) {
                ForEach(links) { link in
                    Button {
                        openURL(link.url)
                    } label: {
                        musicServiceLogo(link)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open in \(link.title)")
                }
            }
            .padding(.top, 4)
        }
    }

    @ViewBuilder
    private func musicServiceLogo(_ link: MusicServiceLink) -> some View {
        Image(link.imageName)
            .resizable()
            .scaledToFit()
            .frame(width: 32, height: 32)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }

    private var lyricsBlock: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(trackTitle)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
                Text(trackSubtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(RrradioTheme.ink3)
                    .lineLimit(1)
                musicServiceButtons
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(player.nowPlayingLyrics?.displayText ?? "")
                .font(.system(size: 14))
                .lineSpacing(5)
                .foregroundStyle(RrradioTheme.ink2)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 6).fill(RrradioTheme.bg2))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(RrradioTheme.line))
    }

    private var controlsBlock: some View {
        VStack(spacing: 18) {
            HStack {
                Spacer()
                Button {
                    player.toggle()
                } label: {
                    ZStack {
                        Circle()
                            .fill(RrradioTheme.accent)
                            .overlay(Circle().stroke(RrradioTheme.accent))
                            .shadow(color: RrradioTheme.accent.opacity(0.18), radius: 18)
                        if player.state == .loading {
                            LoadingDots()
                                .foregroundStyle(RrradioTheme.bg)
                        } else {
                            Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                                .font(.system(size: 23, weight: .semibold))
                                .foregroundStyle(RrradioTheme.bg)
                                .offset(x: player.state == .playing ? 0 : 2)
                        }
                    }
                    .frame(width: 64, height: 64)
                }
                .buttonStyle(.plain)
                .disabled(player.current == nil || player.state == .loading)
                .accessibilityLabel(player.state == .playing ? "Pause" : "Play")
                Spacer()
            }

            HStack(spacing: 18) {
                controlButton(sleepTimer.isArmed ? "moon.zzz.fill" : "moon.zzz", label: "Sleep timer") {
                    sleepTimer.cycle { player.pause() }
                } chip: {
                    sleepTimer.isArmed ? sleepTimer.chipText : nil
                }
                .disabled(player.current == nil)
                controlButton(favoriteIcon, label: "Favorite") {
                    if let station = player.current {
                        library.toggleFavorite(station)
                    }
                }
                .disabled(player.current == nil)
            }
        }
        .padding(.top, 4)
    }

    private var detailsBlock: some View {
        VStack(spacing: 0) {
            if detailsOpen {
                VStack(spacing: 10) {
                    detailRow("country", player.current?.country?.uppercased() ?? "unknown")
                    detailRow("codec", player.current?.codec?.uppercased() ?? "unknown")
                    detailRow("bitrate", bitrateText)
                    detailRow("metadata", player.current?.metadata ?? player.current?.status ?? "stream")
                }
                .padding(.vertical, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private var bottomStrip: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                Circle()
                    .fill(player.state == .playing ? RrradioTheme.accent : RrradioTheme.ink3)
                    .frame(width: 6, height: 6)
                Text(bottomState)
            }

            Spacer(minLength: 10)

            Text(formatLine)
                .lineLimit(1)

            Image(systemName: "chevron.up")
                .font(.system(size: 12, weight: .medium))
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .textCase(.uppercase)
        .tracking(1.2)
        .foregroundStyle(player.state == .playing ? RrradioTheme.ink2 : RrradioTheme.ink3)
        .padding(.horizontal, 24)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(RrradioTheme.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.snappy) {
                detailsOpen.toggle()
            }
        }
    }

    private func controlButton(
        _ systemName: String,
        label: String,
        action: @escaping () -> Void,
        chip: (() -> String?)? = nil,
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: systemName)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(systemName == "heart.fill" ? RrradioTheme.accent : RrradioTheme.ink2)
                        .frame(width: 42, height: 42)
                        .overlay(Circle().stroke(RrradioTheme.line, lineWidth: 1))
                    if let chipText = chip?(), !chipText.isEmpty {
                        Text(chipText)
                            .font(.system(size: 8, weight: .semibold, design: .monospaced))
                            .foregroundStyle(RrradioTheme.bg)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(RrradioTheme.accent))
                            .offset(x: 12, y: -4)
                    }
                }
                Text(label)
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(RrradioTheme.ink4)
            }
            .frame(width: 72)
        }
        .buttonStyle(.plain)
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(RrradioTheme.ink4)
            Spacer()
            Text(value)
                .foregroundStyle(RrradioTheme.ink2)
                .lineLimit(1)
        }
        .font(.system(size: 11, weight: .medium, design: .monospaced))
    }

    private var favoriteIcon: String {
        guard let station = player.current else { return "heart" }
        return library.isFavorite(station) ? "heart.fill" : "heart"
    }

    private var libraryFavoriteColor: Color {
        favoriteIcon == "heart.fill" ? RrradioTheme.accent : RrradioTheme.ink2
    }

    private var tagLine: String {
        guard let station = player.current else { return "live radio" }
        let tags = station.tags?.prefix(4).joined(separator: " . ") ?? ""
        if let country = station.country?.lowercased(), !tags.isEmpty {
            return "\(country) . \(tags)"
        }
        return tags.isEmpty ? (station.country?.lowercased() ?? "live radio") : tags
    }

    private var trackTitle: String {
        if let title = player.nowPlayingTitle?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }
        switch player.state {
        case .loading: return "Connecting"
        case .error: return "Playback error"
        default: return "Live stream"
        }
    }

    private var trackSubtitle: String {
        if let artist = player.nowPlayingArtist?.trimmingCharacters(in: .whitespacesAndNewlines), !artist.isEmpty {
            return artist
        }
        if case .error(let message) = player.state {
            return message
        }
        return player.current?.name ?? ""
    }

    private var hasProgram: Bool {
        clean(player.nowPlayingProgramName) != nil || !player.nowPlayingSchedule.isEmpty || player.isScheduleLoading
    }

    private var hasLyrics: Bool {
        player.nowPlayingLyrics?.isEmpty == false
    }

    private var programTabTitle: String {
        guard let name = clean(player.nowPlayingProgramName) else { return "Program" }
        return "Now on \(name)"
    }

    private func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private var currentScheduleBroadcasts: [ProgramScheduleBroadcast] {
        guard !player.nowPlayingSchedule.isEmpty else { return [] }
        let now = Date()
        let day = player.nowPlayingSchedule.first { day in
            day.broadcasts.contains { $0.start <= now && now < $0.end }
        } ?? player.nowPlayingSchedule.first
        return day?.broadcasts ?? []
    }

    private func isLive(_ broadcast: ProgramScheduleBroadcast) -> Bool {
        let now = Date()
        return broadcast.start <= now && now < broadcast.end
    }

    private func timeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private var bottomState: String {
        switch player.state {
        case .idle: "Standby"
        case .loading: "Loading"
        case .playing: "Live"
        case .paused: "Paused"
        case .error: "Error"
        }
    }

    private var formatLine: String {
        let codec = player.current?.codec?.uppercased()
        let bitrate = bitrateText
        return [codec, bitrate == "unknown" ? nil : bitrate].compactMap { $0 }.joined(separator: " . ")
    }

    private var bitrateText: String {
        guard let bitrate = player.current?.bitrate else { return "unknown" }
        return "\(bitrate) kbps"
    }
}

private struct ArtworkView: View {
    let url: URL?
    let stationName: String
    let stationID: String

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(RrradioTheme.bg2)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(RrradioTheme.line))

            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                            .padding(0)
                    default:
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private var fallback: some View {
        Text(stationInitials(stationName))
            .font(.system(size: 56, weight: .medium, design: .monospaced))
            .foregroundStyle(RrradioTheme.ink3)
    }
}

private struct LoadingDots: View {
    var body: some View {
        TimelineView(.animation) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .frame(width: 7, height: 7)
                        .scaleEffect(dotScale(index: index, phase: phase))
                        .opacity(dotOpacity(index: index, phase: phase))
                }
            }
        }
    }

    private func dotScale(index: Int, phase: TimeInterval) -> Double {
        let offset = phase * 3 - Double(index) * 0.28
        return 0.7 + (sin(offset) + 1) * 0.15
    }

    private func dotOpacity(index: Int, phase: TimeInterval) -> Double {
        let offset = phase * 3 - Double(index) * 0.28
        return 0.45 + (sin(offset) + 1) * 0.25
    }
}

#Preview {
    NowPlayingView()
        .environment(Library(defaults: .standard))
        .environment(AudioPlayer())
        .environment(SleepTimer())
}
