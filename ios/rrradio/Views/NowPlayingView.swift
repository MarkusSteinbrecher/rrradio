import SwiftUI

/// Full-screen player surface opened from the mini player.
struct NowPlayingView: View {
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(LocaleController.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detailsOpen = false
    @State private var pane: Pane = .now
    @State private var showingWakeAlarm = false

    private enum Pane: Hashable {
        case now
        case program
        case lyrics
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            topPanel

            pagedPaneContent
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
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
        .sheet(isPresented: $showingWakeAlarm) {
            WakeAlarmView()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var header: some View {
        ZStack {
            Text(locale.text(.nowPlaying))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(RrradioTheme.ink3)
                .tracking(2)

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
                .accessibilityLabel(locale.text(.dismissNowPlaying))

                Spacer()
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 24)
        .padding(.top, 12)
        .padding(.bottom, 4)
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
        HStack(alignment: .center, spacing: 14) {
            FaviconView(
                url: player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
            )
            .frame(width: 38, height: 38)
            .frame(width: 44, height: 44, alignment: .leading)

            Text(player.current?.name ?? "")
                .font(.system(size: 28, weight: .medium))
                .foregroundStyle(RrradioTheme.ink)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.62)
                .frame(maxWidth: .infinity)
                .fixedSize(horizontal: false, vertical: true)

            roundControlButton(favoriteIcon, label: favoriteIcon == "heart.fill" ? locale.text(.removeFavorite) : locale.text(.addFavorite)) {
                if let station = player.current {
                    library.toggleFavorite(station)
                }
            }
            .disabled(player.current == nil)
            .frame(width: 44, height: 44)
        }
        .padding(.top, 6)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var pagedPaneContent: some View {
        TabView(selection: $pane) {
            paneScroll {
                trackBlock
            }
            .tag(Pane.now)

            if hasProgram {
                paneScroll {
                    programBlock
                }
                .tag(Pane.program)
            }

            if hasLyrics {
                paneScroll {
                    lyricsBlock
                }
                .tag(Pane.lyrics)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .onChange(of: hasProgram) { _, hasProgram in
            if !hasProgram && pane == .program {
                pane = .now
            }
        }
        .onChange(of: hasLyrics) { _, hasLyrics in
            if !hasLyrics && pane == .lyrics {
                pane = .now
            }
        }
    }

    private func paneScroll<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            content()
                .padding(.horizontal, 24)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity)
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
                paneButton("music.note", title: locale.text(.now), pane: .now)
                if hasProgram {
                    paneButton("calendar", title: programTabTitle, pane: .program)
                }
                if hasLyrics {
                    paneButton("text.quote", title: locale.text(.lyrics), pane: .lyrics)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var programBlock: some View {
        VStack(spacing: 16) {
            VStack(spacing: 7) {
                Text(player.nowPlayingProgramName ?? locale.text(.program))
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
                Text(locale.text(.noSchedule))
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.2)
                    .foregroundStyle(RrradioTheme.ink4)
                    .frame(height: 88)
            } else {
                VStack(spacing: 0) {
                    HStack {
                        Text(locale.text(.today))
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
            .background(pane == target ? RrradioTheme.buttonFill : .clear)
            .overlay(Capsule().stroke(pane == target ? RrradioTheme.buttonFill : RrradioTheme.line))
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
        Group {
            switch link.id {
            case "apple-music":
                AppleMusicLogoMark()
            case "spotify":
                SpotifyLogoMark()
            case "youtube-music":
                YouTubeMusicLogoMark()
            default:
                Image(link.imageName)
                    .resizable()
                    .scaledToFit()
            }
        }
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
        HStack(alignment: .center) {
            playerStatusButton
            .frame(maxWidth: .infinity, alignment: .leading)

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
            .accessibilityLabel(player.state == .playing ? locale.text(.pause) : locale.text(.play))

            HStack(spacing: 14) {
                roundControlButton(wakeAlarm.isArmed ? "alarm.fill" : "alarm", label: locale.text(.wakeToRadio)) {
                    showingWakeAlarm = true
                } chip: {
                    wakeAlarm.isArmed ? wakeAlarm.chipText : nil
                }
                .disabled(player.current == nil && !wakeAlarm.isArmed)
                roundControlButton(sleepTimer.isArmed ? "moon.zzz.fill" : "moon.zzz", label: locale.text(.sleepTimer)) {
                    sleepTimer.cycle { player.pause() }
                } chip: {
                    sleepTimer.isArmed ? sleepTimer.chipText : SleepTimer.format(sleepTimer.defaultMinutes)
                }
                .disabled(player.current == nil)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.top, 4)
    }

    private var playerStatusButton: some View {
        Button {
            withAnimation(.snappy) {
                detailsOpen.toggle()
            }
        } label: {
            HStack(alignment: .center, spacing: 9) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(player.state == .playing ? RrradioTheme.accent : RrradioTheme.ink3)
                            .frame(width: 6, height: 6)
                        Text(bottomState)
                    }
                    Text(formatLine)
                        .lineLimit(1)
                }
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.1)
                .foregroundStyle(player.state == .playing ? RrradioTheme.ink2 : RrradioTheme.ink3)

                Image(systemName: detailsOpen ? "chevron.down" : "chevron.up")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink3)
            }
            .frame(minWidth: 86, maxWidth: 118, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(detailsOpen ? locale.text(.collapseStreamDetails) : locale.text(.expandStreamDetails))
    }

    private var detailsBlock: some View {
        VStack(spacing: 0) {
            if detailsOpen {
                VStack(spacing: 10) {
                    detailRow(locale.text(.countryDetail), player.current?.country?.uppercased() ?? locale.text(.unknown))
                    detailRow(locale.text(.codec), player.current?.codec?.uppercased() ?? locale.text(.unknown))
                    detailRow(locale.text(.bitrate), bitrateText)
                    detailRow(locale.text(.metadata), player.current?.metadata ?? player.current?.status ?? locale.text(.stream))
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

    private func roundControlButton(
        _ systemName: String,
        label: String,
        action: @escaping () -> Void,
        chip: (() -> String?)? = nil,
    ) -> some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: systemName)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(activeControlIconColor(systemName))
                    .frame(width: 44, height: 44)
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
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func activeControlIconColor(_ systemName: String) -> Color {
        switch systemName {
        case "heart.fill", "alarm.fill", "moon.zzz.fill":
            return RrradioTheme.accent
        default:
            return RrradioTheme.ink2
        }
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
        case .idle: locale.text(.standby)
        case .loading: locale.text(.loading)
        case .playing: locale.text(.live)
        case .paused: locale.text(.paused)
        case .error: locale.text(.playbackError)
        }
    }

    private var formatLine: String {
        let codec = player.current?.codec?.uppercased()
        let bitrate = bitrateText
        return [codec, bitrate == locale.text(.unknown) ? nil : bitrate].compactMap { $0 }.joined(separator: " . ")
    }

    private var bitrateText: String {
        guard let bitrate = player.current?.bitrate else { return locale.text(.unknown) }
        return "\(bitrate) kbps"
    }
}

private struct WakeAlarmView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(LocaleController.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var wakeDate = Date()

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 8) {
                Image(systemName: wakeAlarm.isArmed ? "alarm.fill" : "alarm")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(wakeAlarm.isArmed ? RrradioTheme.accent : RrradioTheme.ink3)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(locale.text(.wakeToRadio))
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    if wakeAlarm.isArmed {
                        TimelineView(.periodic(from: .now, by: 30)) { timeline in
                            Text(WakeAlarm.formatCountdown(wakeAlarm.firesAt?.timeIntervalSince(timeline.date) ?? 0))
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .textCase(.uppercase)
                                .foregroundStyle(RrradioTheme.bg)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(Capsule().fill(RrradioTheme.accent))
                        }
                    }
                }
                Text(targetLine)
                    .font(.system(size: 12))
                    .foregroundStyle(RrradioTheme.ink3)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }

            DatePicker(locale.text(.wakeTime), selection: $wakeDate, displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxHeight: 132)

            Button {
                if wakeAlarm.isArmed {
                    wakeAlarm.disarm()
                } else if let station = player.current {
                    wakeAlarm.arm(station: station, time: timeString(from: wakeDate)) { station in
                        player.play(station)
                    }
                }
                dismiss()
            } label: {
                VStack(spacing: 3) {
                    Text(wakeAlarm.isArmed ? locale.text(.unset) : locale.text(.set))
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                    if wakeAlarm.isArmed {
                        Text("\(wakeAlarm.time) . \(wakeAlarm.countdownText)")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .textCase(.lowercase)
                    }
                }
                .foregroundStyle(wakeAlarm.isArmed ? RrradioTheme.ink : RrradioTheme.bg)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(wakeAlarm.isArmed ? RrradioTheme.bg2 : RrradioTheme.buttonFill)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(wakeAlarm.isArmed ? RrradioTheme.line : RrradioTheme.buttonFill))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled(!wakeAlarm.isArmed && player.current == nil)

            Text(locale.text(.wakeHint))
                .font(.system(size: 11))
                .foregroundStyle(RrradioTheme.ink4)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RrradioTheme.bg.ignoresSafeArea())
        .onAppear {
            wakeDate = dateFromTime(wakeAlarm.time) ?? Date()
        }
    }

    private var targetLine: String {
        if let station = wakeAlarm.station {
            return "Armed for \(station.name)"
        }
        if let station = player.current {
            return "Set an alarm for \(station.name)"
        }
        return locale.text(.playStationFirst)
    }

    private func timeString(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 7, components.minute ?? 0)
    }

    private func dateFromTime(_ time: String) -> Date? {
        let parts = time.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else {
            return nil
        }
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = hour
        components.minute = minute
        return Calendar.current.date(from: components)
    }
}

private struct AppleMusicLogoMark: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.98, green: 0.18, blue: 0.44),
                        Color(red: 0.62, green: 0.20, blue: 0.98),
                        Color(red: 0.16, green: 0.48, blue: 1),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing,
                ),
            )
            .overlay {
                Image(systemName: "music.note")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
            }
    }
}

private struct SpotifyLogoMark: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.12, green: 0.84, blue: 0.38))
            Canvas { context, size in
                let width = size.width
                let height = size.height
                let strokes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
                    (0.22, 0.42, 0.78, 0.34),
                    (0.27, 0.56, 0.73, 0.51),
                    (0.31, 0.69, 0.68, 0.66),
                ]

                for (index, stroke) in strokes.enumerated() {
                    var path = Path()
                    path.move(to: CGPoint(x: stroke.0 * width, y: stroke.1 * height))
                    path.addCurve(
                        to: CGPoint(x: stroke.2 * width, y: stroke.3 * height),
                        control1: CGPoint(x: 0.38 * width, y: (stroke.1 - 0.07) * height),
                        control2: CGPoint(x: 0.58 * width, y: (stroke.3 - 0.05) * height),
                    )
                    context.stroke(
                        path,
                        with: .color(.white),
                        style: StrokeStyle(
                            lineWidth: max(2.8, width * (index == 0 ? 0.09 : 0.075)),
                            lineCap: .round,
                            lineJoin: .round,
                        ),
                    )
                }
            }
            .padding(2)
        }
    }
}

private struct YouTubeMusicLogoMark: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color(red: 1, green: 0, blue: 0))
            Circle()
                .stroke(.white, lineWidth: 3)
                .frame(width: 18, height: 18)
            Image(systemName: "play.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .offset(x: 1)
        }
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
        .environment(WakeAlarm())
        .environment(LocaleController())
}
