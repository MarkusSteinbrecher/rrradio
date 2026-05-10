import SwiftUI
import UIKit

/// Full-screen player surface opened from the mini player.
struct NowPlayingView: View {
    @Environment(Library.self) private var library
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(LocaleController.self) private var locale
    @Environment(CarModeController.self) private var carMode
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detailsOpen = false
    @State private var pane: Pane = .now
    @State private var showingWakeAlarm = false
    @State private var showingSleepTimer = false
    @State private var isReportingBrokenStation = false
    @State private var brokenReportStatus: BrokenReportStatus?

    private enum Pane: Hashable {
        case now
        case program
        case lyrics
    }

    private enum BrokenReportStatus: Equatable {
        case sent
        case failed
    }

    var body: some View {
        Group {
            if carMode.isActive {
                carModeBody
            } else if verticalSizeClass == .compact {
                landscapeBody
            } else {
                regularBody
            }
        }
        .sheet(isPresented: $showingWakeAlarm) {
            WakeAlarmView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingSleepTimer) {
            SleepTimerView()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: player.current?.id) { _, _ in
            brokenReportStatus = nil
        }
    }

    private var regularBody: some View {
        VStack(spacing: 0) {
            header

            topPanel

            pagedPaneContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            musicServiceRail
                .padding(.horizontal, 24)
                .padding(.bottom, 8)

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
                    .frame(width: UIScreen.main.bounds.width, height: 1)
            }
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    private var landscapeBody: some View {
        VStack(spacing: 0) {
            landscapeStationBar

            VStack(spacing: 0) {
                GeometryReader { proxy in
                    let artworkColumnWidth = min(320, max(268, proxy.size.width * 0.39))
                    HStack(spacing: 0) {
                        landscapeArtworkPanel(
                            availableHeight: proxy.size.height,
                            availableWidth: artworkColumnWidth,
                        )
                            .frame(width: artworkColumnWidth)
                            .frame(maxHeight: .infinity)
                            .background(RrradioTheme.bg)

                        VStack(spacing: 0) {
                            if hasProgram || hasLyrics {
                                landscapePaneTabs
                                    .padding(.top, 8)
                                    .padding(.bottom, 8)
                                    .background(RrradioTheme.bg)
                            }

                            landscapePaneContent
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }

                landscapeBottomBar
            }
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
        .onAppear {
            if hasProgram {
                pane = .program
            } else if hasLyrics {
                pane = .lyrics
            }
        }
    }

    private var landscapeStationBar: some View {
        ZStack {
            Text(player.current?.name ?? locale.text(.noStation))
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(RrradioTheme.ink)
                .multilineTextAlignment(.center)
                .lineLimit(1)
                .minimumScaleFactor(0.62)
                .padding(.horizontal, 166)
                .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink2)
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(locale.text(.dismissNowPlaying))

                FaviconView(
                    url: player.current?.favicon,
                    stationName: player.current?.name ?? "",
                    stationID: player.current?.id ?? "",
                    size: 34,
                )
                .frame(width: 34, height: 34)

                Spacer(minLength: 12)

                HStack(spacing: 2) {
                    musicServiceButtons
                }

                roundControlButton(favoriteIcon, label: favoriteIcon == "heart.fill" ? locale.text(.removeFavorite) : locale.text(.addFavorite)) {
                    if let station = player.current {
                        library.toggleFavorite(station)
                    }
                }
                .disabled(player.current == nil)
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 58)
        .background(RrradioTheme.bg)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func landscapeArtworkPanel(availableHeight: CGFloat, availableWidth: CGFloat) -> some View {
        let artworkSize = min(max(160, availableWidth - 18), max(160, availableHeight - 92))
        return VStack(spacing: 8) {
            Image(systemName: "photo.on.rectangle")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
                .frame(width: 46, height: 32)
                .overlay(Capsule().stroke(RrradioTheme.line))
                .clipShape(Capsule())
                .padding(.top, 8)

            ArtworkView(
                url: player.nowPlayingCoverUrl ?? player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
            )
            .frame(width: artworkSize, height: artworkSize)
            .padding(.top, 0)

            VStack(spacing: 4) {
                Text(trackTitle)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.75)

                Text(trackSubtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(RrradioTheme.ink3)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)

            Spacer(minLength: 0)
        }
    }

    private var landscapeBottomBar: some View {
        HStack(alignment: .center) {
            playerStatusButton
                .frame(minWidth: 98, maxWidth: .infinity, alignment: .leading)

            Button {
                player.toggle()
            } label: {
                ZStack {
                    Circle()
                        .fill(RrradioTheme.accent)
                        .overlay(Circle().stroke(RrradioTheme.accent))
                        .shadow(color: RrradioTheme.accent.opacity(0.18), radius: 14)
                    if player.state == .loading {
                        LoadingDots()
                            .foregroundStyle(RrradioTheme.bg)
                    } else {
                        Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 19, weight: .semibold))
                            .foregroundStyle(RrradioTheme.bg)
                            .offset(x: player.state == .playing ? 0 : 2)
                    }
                }
                .frame(width: 52, height: 52)
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
                    showingSleepTimer = true
                } chip: {
                    sleepTimer.isArmed ? sleepTimer.chipText : nil
                }
                .disabled(player.current == nil && !sleepTimer.isArmed)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(RrradioTheme.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(maxWidth: .infinity)
                .frame(height: 1)
        }
        .ignoresSafeArea(.container, edges: .bottom)
    }

    private var carModeBody: some View {
        VStack(spacing: 0) {
            header
            stationDivider
                .padding(.top, 8)

            Spacer(minLength: 18)

            ArtworkView(
                url: player.nowPlayingCoverUrl ?? player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
            )
            .frame(width: 250, height: 250)

            VStack(spacing: 8) {
                Text(player.current?.name ?? locale.text(.noStation))
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)

                Text(trackTitle)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink2)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)

                Text(trackSubtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(RrradioTheme.ink3)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
            }
            .padding(.horizontal, 28)
            .padding(.top, 22)

            HStack(spacing: 8) {
                Image(systemName: "car.fill")
                    .font(.system(size: 12, weight: .semibold))
                Text(locale.text(.carMode))
                Text(carMode.routeLabel)
                    .foregroundStyle(RrradioTheme.ink4)
                    .lineLimit(1)
            }
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.1)
            .foregroundStyle(RrradioTheme.ink3)
            .padding(.top, 14)
            .padding(.horizontal, 24)

            Spacer(minLength: 18)

            VStack(spacing: 18) {
                Button {
                    player.toggle()
                } label: {
                    ZStack {
                        Circle()
                            .fill(RrradioTheme.accent)
                            .shadow(color: RrradioTheme.accent.opacity(0.18), radius: 20)
                        if player.state == .loading {
                            LoadingDots()
                                .foregroundStyle(RrradioTheme.bg)
                        } else {
                            Image(systemName: player.state == .playing ? "pause.fill" : "play.fill")
                                .font(.system(size: 34, weight: .semibold))
                                .foregroundStyle(RrradioTheme.bg)
                                .offset(x: player.state == .playing ? 0 : 3)
                        }
                    }
                    .frame(width: 92, height: 92)
                }
                .buttonStyle(.plain)
                .disabled(player.current == nil || player.state == .loading)

                HStack(spacing: 24) {
                    roundControlButton(favoriteIcon, label: favoriteIcon == "heart.fill" ? locale.text(.removeFavorite) : locale.text(.addFavorite)) {
                        if let station = player.current {
                            library.toggleFavorite(station)
                        }
                    }
                    .disabled(player.current == nil)

                    roundControlButton(wakeAlarm.isArmed ? "alarm.fill" : "alarm", label: locale.text(.wakeToRadio)) {
                        showingWakeAlarm = true
                    } chip: {
                        wakeAlarm.isArmed ? wakeAlarm.chipText : nil
                    }
                    .disabled(player.current == nil && !wakeAlarm.isArmed)

                    roundControlButton(sleepTimer.isArmed ? "moon.zzz.fill" : "moon.zzz", label: locale.text(.sleepTimer)) {
                        showingSleepTimer = true
                    } chip: {
                        sleepTimer.isArmed ? sleepTimer.chipText : nil
                    }
                    .disabled(player.current == nil && !sleepTimer.isArmed)
                }
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
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
        .padding(.bottom, 0)
    }

    private var topPanel: some View {
        VStack(spacing: 0) {
            stationBlock
            stationDivider
                .padding(.top, 10)
            paneTabs
                .padding(.top, 14)
        }
        .padding(.top, 4)
        .padding(.bottom, 10)
        .background(RrradioTheme.bg)
    }

    private var stationBlock: some View {
        HStack(alignment: .center, spacing: 14) {
            FaviconView(
                url: player.current?.favicon,
                stationName: player.current?.name ?? "",
                stationID: player.current?.id ?? "",
                size: 38,
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
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }

    private var stationDivider: some View {
        Rectangle()
            .fill(RrradioTheme.line)
            .frame(width: UIScreen.main.bounds.width, height: 1)
    }

    @ViewBuilder
    private var pagedPaneContent: some View {
        TabView(selection: $pane) {
            nowPaneContent
            .tag(Pane.now)

            if hasProgram {
                programPaneContent
                .tag(Pane.program)
            }

            if hasLyrics {
                lyricsPaneContent
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

    @ViewBuilder
    private var landscapePaneContent: some View {
        if hasProgram || hasLyrics {
            TabView(selection: $pane) {
                if hasProgram {
                    landscapeProgramPaneContent
                        .tag(Pane.program)
                }

                if hasLyrics {
                    landscapeLyricsPaneContent
                        .tag(Pane.lyrics)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .onChange(of: hasProgram) { _, hasProgram in
                if !hasProgram && pane == .program {
                    pane = hasLyrics ? .lyrics : .now
                } else if hasProgram && pane == .now {
                    pane = .program
                }
            }
            .onChange(of: hasLyrics) { _, hasLyrics in
                if !hasLyrics && pane == .lyrics {
                    pane = hasProgram ? .program : .now
                } else if hasLyrics && pane == .now && !hasProgram {
                    pane = .lyrics
                }
            }
        } else {
            landscapeNowPaneContent
        }
    }

    private var landscapePaneTabs: some View {
        HStack(spacing: 8) {
            paneButton("calendar", title: programTabTitle, pane: .program, enabled: hasProgram)
            paneButton("text.quote", title: locale.text(.lyrics), pane: .lyrics, enabled: hasLyrics)
        }
        .frame(height: 32)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
    }

    private func paneScroll<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            content()
                .padding(.horizontal, 24)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity)
        }
    }

    private var nowPaneContent: some View {
        GeometryReader { proxy in
            ScrollView {
                trackBlock
                    .padding(.horizontal, 24)
                    .padding(.top, max(8, (proxy.size.height - 314) / 2))
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var landscapeNowPaneContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(trackTitle)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(3)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(trackSubtitle)
                    .font(.system(size: 15))
                    .foregroundStyle(RrradioTheme.ink3)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let station = player.current {
                    VStack(spacing: 10) {
                        detailRow(locale.text(.stream), station.streamUrl.absoluteString)
                        detailRow(locale.text(.countryDetail), countryDetailText)
                        detailRow(locale.text(.format), formatDetailText)
                        detailRow(locale.text(.genres), genresDetailText)
                    }
                    .padding(.top, 10)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RrradioTheme.bg)
    }

    private var programPaneContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                programBlock
                    .padding(.horizontal, 24)
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity)
            }
            .onAppear {
                scrollToLiveProgram(using: proxy, animated: false)
            }
            .onChange(of: pane) { _, value in
                if value == .program {
                    scrollToLiveProgram(using: proxy)
                }
            }
            .onChange(of: liveScheduleBroadcastID) { _, _ in
                if pane == .program {
                    scrollToLiveProgram(using: proxy)
                }
            }
        }
    }

    private var landscapeProgramPaneContent: some View {
        ScrollViewReader { proxy in
            ScrollView {
                programBlock
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity, alignment: .top)
            }
            .background(RrradioTheme.bg)
            .onAppear {
                scrollToLiveProgram(using: proxy, animated: false)
            }
            .onChange(of: pane) { _, value in
                if value == .program {
                    scrollToLiveProgram(using: proxy)
                }
            }
            .onChange(of: liveScheduleBroadcastID) { _, _ in
                if pane == .program {
                    scrollToLiveProgram(using: proxy)
                }
            }
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
        }
    }

    private var paneTabs: some View {
        HStack(spacing: 8) {
            paneButton("photo.on.rectangle", title: locale.text(.now), pane: .now, enabled: true)
            paneButton("calendar", title: programTabTitle, pane: .program, enabled: hasProgram)
            paneButton("text.quote", title: locale.text(.lyrics), pane: .lyrics, enabled: hasLyrics)
        }
        .frame(height: 32)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
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
                            .id(broadcast.id)
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

    private func paneButton(_ icon: String, title: String, pane target: Pane, enabled: Bool) -> some View {
        Button {
            if enabled {
                withAnimation(.snappy) {
                    pane = target
                }
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: icon)
                Text(title)
                    .lineLimit(1)
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(pane == target ? RrradioTheme.bg : enabled ? RrradioTheme.ink3 : RrradioTheme.ink4)
            .padding(.horizontal, 14)
            .frame(height: 32)
            .background(pane == target ? RrradioTheme.buttonFill : .clear)
            .overlay(Capsule().stroke(pane == target ? RrradioTheme.buttonFill : enabled ? RrradioTheme.line : RrradioTheme.line.opacity(0.45)))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private var musicServiceRail: some View {
        HStack(spacing: 12) {
            if pane != .lyrics {
                musicServiceButtons
            }
        }
        .frame(height: 44)
        .frame(maxWidth: .infinity)
        .background(RrradioTheme.bg)
    }

    @ViewBuilder
    private var musicServiceButtons: some View {
        let links = musicServiceLinks(artist: player.nowPlayingArtist, title: player.nowPlayingTitle)
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
            Text(player.nowPlayingLyrics?.displayText ?? "")
                .font(.system(size: 14))
                .lineSpacing(5)
                .foregroundStyle(RrradioTheme.ink2)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let source = player.nowPlayingLyrics?.source {
                Link(destination: source.url) {
                    HStack(spacing: 7) {
                        Image(systemName: "link")
                            .font(.system(size: 11, weight: .medium))
                        Text("Lyrics source: \(source.name)")
                            .lineLimit(1)
                    }
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .textCase(.uppercase)
                    .tracking(1.1)
                    .foregroundStyle(RrradioTheme.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 2)
                }
            }
        }
    }

    private var lyricsPaneContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            lyricsHeader
                .padding(.horizontal, 24)
                .padding(.top, 18)
                .padding(.bottom, 12)
                .background(RrradioTheme.bg)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(RrradioTheme.line)
                        .frame(height: 1)
                }

            ScrollView {
                lyricsBlock
                    .padding(.horizontal, 24)
                    .padding(.top, 16)
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RrradioTheme.bg)
    }

    private var landscapeLyricsPaneContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            lyricsHeader
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 10)
                .background(RrradioTheme.bg)

            ScrollView {
                lyricsBlock
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
                    .padding(.bottom, 18)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(RrradioTheme.bg)
    }

    private var lyricsHeader: some View {
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
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                    showingSleepTimer = true
                } chip: {
                    sleepTimer.isArmed ? sleepTimer.chipText : nil
                }
                .disabled(player.current == nil && !sleepTimer.isArmed)
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
                    if let homepage = player.current?.homepage {
                        detailLinkRow(locale.text(.website), url: homepage)
                    }
                    if let station = player.current {
                        detailLinkRow(locale.text(.stream), url: station.streamUrl)
                    }
                    detailRow(locale.text(.countryDetail), countryDetailText)
                    detailRow(locale.text(.format), formatDetailText)
                    detailRow(locale.text(.genres), genresDetailText)
                    detailRow(locale.text(.metadata), player.current?.metadata ?? player.current?.status ?? locale.text(.stream))
                    if let station = player.current {
                        Button {
                            Task { await reportBroken(station) }
                        } label: {
                            Label(brokenReportTitle, systemImage: brokenReportIcon)
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .textCase(.uppercase)
                                .tracking(1.0)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 4)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(brokenReportColor)
                        .disabled(isReportingBrokenStation)
                    }
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
        case "heart.fill":
            return RrradioTheme.favoriteFill
        case "alarm.fill", "moon.zzz.fill":
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

    private func detailLinkRow(_ label: String, url: URL) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .foregroundStyle(RrradioTheme.ink4)
            Spacer()
            Link(destination: url) {
                Text(url.absoluteString)
                    .foregroundStyle(RrradioTheme.accent)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .lineLimit(1)
        }
        .font(.system(size: 11, weight: .medium, design: .monospaced))
    }

    private var brokenReportTitle: String {
        if isReportingBrokenStation {
            return "Sending report"
        }
        switch brokenReportStatus {
        case .sent:
            return "Report sent"
        case .failed:
            return "Report failed"
        case nil:
            return "Report broken station"
        }
    }

    private var brokenReportIcon: String {
        if isReportingBrokenStation {
            return "paperplane"
        }
        switch brokenReportStatus {
        case .sent:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        case nil:
            return "exclamationmark.triangle"
        }
    }

    private var brokenReportColor: Color {
        switch brokenReportStatus {
        case .sent:
            return RrradioTheme.accent
        case .failed:
            return RrradioTheme.favoriteFill
        case nil:
            return RrradioTheme.ink2
        }
    }

    @MainActor
    private func reportBroken(_ station: Station) async {
        guard !isReportingBrokenStation else { return }
        isReportingBrokenStation = true
        brokenReportStatus = nil

        do {
            try await BrokenStationReporter.report(station: station, playbackState: player.state)
            brokenReportStatus = .sent
            diagnosticRecord(
                "report",
                "broken station sent",
                details: ["station": station.name, "stationID": station.id],
            )
        } catch {
            brokenReportStatus = .failed
            diagnosticRecord(
                "report",
                "broken station failed",
                details: [
                    "station": station.name,
                    "stationID": station.id,
                    "error": error.localizedDescription,
                ],
            )
        }

        isReportingBrokenStation = false
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
        clean(player.nowPlayingProgramName) ?? locale.text(.program)
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

    private var liveScheduleBroadcastID: String? {
        currentScheduleBroadcasts.first(where: isLive)?.id
    }

    private func isLive(_ broadcast: ProgramScheduleBroadcast) -> Bool {
        let now = Date()
        return broadcast.start <= now && now < broadcast.end
    }

    private func scrollToLiveProgram(using proxy: ScrollViewProxy, animated: Bool = true) {
        guard let id = liveScheduleBroadcastID else { return }
        DispatchQueue.main.async {
            if animated {
                withAnimation(.snappy) {
                    proxy.scrollTo(id, anchor: .center)
                }
            } else {
                proxy.scrollTo(id, anchor: .center)
            }
        }
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
        return [
            codec,
            bitrate == locale.text(.unknown) ? nil : bitrate,
            streamQualityMeter(codec: player.current?.codec, bitrate: player.current?.bitrate),
        ]
        .compactMap { $0 }
        .joined(separator: " . ")
    }

    private var bitrateText: String {
        guard let bitrate = player.current?.bitrate else { return locale.text(.unknown) }
        return "\(bitrate) kbps"
    }

    private var countryDetailText: String {
        guard let country = player.current?.country?.trimmingCharacters(in: .whitespacesAndNewlines),
              !country.isEmpty else {
            return locale.text(.unknown)
        }
        return countryDisplayName(country)
    }

    private var bitrateDetailText: String {
        guard player.current?.bitrate != nil else { return locale.text(.unknown) }
        return [
            bitrateText,
            streamQualityMeter(codec: player.current?.codec, bitrate: player.current?.bitrate),
        ]
        .joined(separator: " . ")
    }

    private var formatDetailText: String {
        let codec = player.current?.codec?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        let bitrate = player.current?.bitrate.map { "\($0) kbps" }
        let quality = codec?.isEmpty == false || bitrate != nil
            ? "\(streamQualityLevel(codec: player.current?.codec, bitrate: player.current?.bitrate))/4"
            : nil
        let parts = [codec?.isEmpty == false ? codec : nil, bitrate, quality].compactMap { $0 }
        return parts.isEmpty ? locale.text(.unknown) : parts.joined(separator: " . ")
    }

    private var genresDetailText: String {
        let tags = player.current?.tags?
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(5)
            .joined(separator: " . ")
        return tags?.isEmpty == false ? tags! : locale.text(.unknown)
    }
}

struct WakeAlarmView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(WakeAlarm.self) private var wakeAlarm
    @Environment(LocaleController.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var wakeDate = Date()
    @State private var keepAliveEnabled = false

    var body: some View {
        VStack(spacing: 20) {
            header

            DatePicker(locale.text(.wakeTime), selection: $wakeDate, displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(height: 190)

            if wakeAlarm.notificationPermissionDenied {
                notificationWarning
            }

            Toggle(isOn: $keepAliveEnabled) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(locale.text(.wakeKeepAlive))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    Text(locale.text(.wakeKeepAliveDetail))
                        .font(.system(size: 11))
                        .foregroundStyle(RrradioTheme.ink3)
                        .lineLimit(3)
                }
            }
            .tint(RrradioTheme.accent)
            .padding(12)
            .background(RrradioTheme.bg2)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .disabled(wakeAlarm.isArmed)

            Button {
                if buttonSetsWake, let station = wakeTargetStation {
                    Task {
                        let notificationsAvailable = wakeAlarm.notificationsEnabled
                            ? await wakeAlarm.requestNotificationAuthorizationIfNeeded()
                            : true
                        wakeAlarm.arm(station: station, time: selectedWakeTime, keepAliveEnabled: keepAliveEnabled) { station in
                            player.stopWakeKeepAlive()
                            player.play(station)
                        }
                        if keepAliveEnabled {
                            if player.state != .playing {
                                _ = player.startWakeKeepAlive()
                            }
                        }
                        if notificationsAvailable {
                            dismiss()
                        }
                    }
                } else if wakeAlarm.isArmed {
                    wakeAlarm.disarm()
                    player.stopWakeKeepAlive()
                    dismiss()
                }
            } label: {
                VStack(spacing: 3) {
                    Text(buttonSetsWake ? locale.text(.set) : locale.text(.unset))
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                    if wakeAlarm.isArmed {
                        Text(buttonSubtitle)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .textCase(.lowercase)
                    }
                }
                .foregroundStyle(buttonSetsWake ? RrradioTheme.bg : RrradioTheme.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(buttonSetsWake ? RrradioTheme.buttonFill : RrradioTheme.bg2)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(buttonSetsWake ? RrradioTheme.buttonFill : RrradioTheme.line))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled(buttonSetsWake && wakeTargetStation == nil)

            Text(locale.text(.wakeHint))
                .font(.system(size: 11))
                .foregroundStyle(RrradioTheme.accent)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
        }
        .padding(.horizontal, 24)
        .padding(.top, 4)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RrradioTheme.bg.ignoresSafeArea())
        .onAppear {
            wakeDate = dateFromTime(wakeAlarm.time) ?? Date()
            keepAliveEnabled = wakeAlarm.keepAliveEnabled
            wakeAlarm.refreshNotificationAuthorization()
        }
    }

    private var header: some View {
        VStack(spacing: 14) {
            Image(systemName: wakeAlarm.isArmed ? "alarm.fill" : "alarm")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(wakeAlarm.isArmed ? RrradioTheme.accent : RrradioTheme.ink3)

            HStack(alignment: .center, spacing: 10) {
                Text(locale.text(.wakeToRadio))
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)

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
                    .fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)

            stationIdentity
                .padding(.top, 2)
        }
    }

    @ViewBuilder
    private var stationIdentity: some View {
        if let station = wakeTargetStation {
            HStack(spacing: 10) {
                FaviconView(url: station.favicon, stationName: station.name, stationID: station.id, size: 42)
                    .frame(width: 42, height: 42)
                Text(station.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(RrradioTheme.bg2)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .frame(maxWidth: .infinity)
        } else {
            Text(locale.text(.playStationFirst))
                .font(.system(size: 12))
                .foregroundStyle(RrradioTheme.ink3)
                .lineLimit(1)
        }
    }

    private var selectedWakeTime: String {
        timeString(from: wakeDate)
    }

    private var isEditingArmedWake: Bool {
        wakeAlarm.isArmed && selectedWakeTime != wakeAlarm.time
    }

    private var buttonSetsWake: Bool {
        !wakeAlarm.isArmed || isEditingArmedWake
    }

    private var buttonSubtitle: String {
        if isEditingArmedWake {
            return selectedWakeTime
        }
        return "\(wakeAlarm.time) . \(wakeAlarm.countdownText)"
    }

    private var wakeTargetStation: Station? {
        wakeAlarm.station ?? player.current
    }

    private var notificationWarning: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "bell.slash.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(RrradioTheme.accent)
                    .frame(width: 20)
                Text(locale.text(.wakeNotificationsDeniedWarning))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            } label: {
                Text(locale.text(.openSettings))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                    .foregroundStyle(RrradioTheme.bg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(RrradioTheme.buttonFill)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(RrradioTheme.bg2)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(RrradioTheme.accent.opacity(0.7)))
        .clipShape(RoundedRectangle(cornerRadius: 6))
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

private struct SleepTimerView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(SleepTimer.self) private var sleepTimer
    @Environment(LocaleController.self) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var sleepDate = Date()

    var body: some View {
        VStack(spacing: 18) {
            VStack(spacing: 8) {
                Image(systemName: sleepTimer.isArmed ? "moon.zzz.fill" : "moon.zzz")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(sleepTimer.isArmed ? RrradioTheme.accent : RrradioTheme.ink3)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(locale.text(.sleepTimer))
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                    if sleepTimer.isArmed {
                        TimelineView(.periodic(from: .now, by: 30)) { timeline in
                            Text(sleepTimer.countdownText(at: timeline.date))
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

            DatePicker(locale.text(.sleepTimer), selection: $sleepDate, displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxHeight: 132)

            Button {
                if sleepTimer.isArmed {
                    sleepTimer.cancel()
                } else {
                    sleepTimer.set(minutes: max(1, minutes(from: sleepDate))) {
                        player.pause()
                    }
                }
                dismiss()
            } label: {
                Text(sleepTimer.isArmed ? locale.text(.unset) : locale.text(.set))
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .textCase(.uppercase)
                .foregroundStyle(sleepTimer.isArmed ? RrradioTheme.ink : RrradioTheme.bg)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(sleepTimer.isArmed ? RrradioTheme.bg2 : RrradioTheme.buttonFill)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(sleepTimer.isArmed ? RrradioTheme.line : RrradioTheme.buttonFill))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled(!sleepTimer.isArmed && player.current == nil)

            Text(locale.text(.playStationFirst))
                .font(.system(size: 11))
                .foregroundStyle(RrradioTheme.ink4)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .opacity(player.current == nil && !sleepTimer.isArmed ? 1 : 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RrradioTheme.bg.ignoresSafeArea())
        .onAppear {
            sleepDate = dateFromMinutes(sleepTimer.isArmed ? sleepTimer.minutes : sleepTimer.defaultMinutes)
        }
    }

    private var targetLine: String {
        if sleepTimer.isArmed {
            return "Playback pauses when the timer ends"
        }
        if let station = player.current {
            return "Set a sleep timer for \(station.name)"
        }
        return locale.text(.playStationFirst)
    }

    private func minutes(from date: Date) -> Int {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return ((components.hour ?? 0) * 60) + (components.minute ?? 0)
    }

    private func dateFromMinutes(_ minutes: Int) -> Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = minutes / 60
        components.minute = minutes % 60
        return Calendar.current.date(from: components) ?? Date()
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
        .environment(CarModeController())
}
