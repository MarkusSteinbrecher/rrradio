import SwiftUI

struct IPadRootView: View {
    @Environment(AudioPlayer.self) private var player
    @Environment(LocaleController.self) private var locale
    @Binding var tab: AppTab
    @Binding var searchFocused: Bool

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 260)
        } content: {
            StationListView(tab: $tab, searchFocusedExternally: $searchFocused)
                .navigationBarTitleDisplayMode(.inline)
                .background(RrradioTheme.bg)
                .navigationSplitViewColumnWidth(min: 360, ideal: 460, max: 560)
        } detail: {
            detailPane
                .background(RrradioTheme.bg)
        }
        .navigationSplitViewStyle(.balanced)
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("r r r")
                    .foregroundStyle(RrradioTheme.accent)
                Text("a d i o . o r g")
                    .foregroundStyle(RrradioTheme.ink)
            }
            .font(.system(size: 16, weight: .medium))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 16)

            VStack(spacing: 6) {
                sidebarButton(.browse, icon: "globe", title: locale.text(.browse))
                sidebarButton(.favorites, icon: "heart", title: locale.text(.favorites))
            }
            .padding(.horizontal, 10)

            Spacer(minLength: 0)

            if let station = player.current {
                VStack(alignment: .leading, spacing: 8) {
                    Text(locale.text(.nowPlaying))
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(1.4)
                        .foregroundStyle(RrradioTheme.ink3)

                    HStack(spacing: 10) {
                        FaviconView(
                            url: station.favicon,
                            stationName: station.name,
                            stationID: station.id,
                            size: 34,
                        )
                        .frame(width: 34, height: 34)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(station.name)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(RrradioTheme.ink)
                                .lineLimit(2)
                                .minimumScaleFactor(0.82)

                            playbackIndicator
                        }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RrradioTheme.bg2)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 12)
                .padding(.bottom, 16)
            }
        }
        .background(RrradioTheme.bg)
    }

    private func sidebarButton(_ value: AppTab, icon: String, title: String) -> some View {
        Button {
            withAnimation(.snappy) {
                tab = value
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 24, height: 24)
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(tab == value ? RrradioTheme.bg : RrradioTheme.ink)
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(tab == value ? RrradioTheme.accent : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var playbackIndicator: some View {
        switch player.state {
        case .loading:
            ProgressView()
                .controlSize(.mini)
                .tint(RrradioTheme.accent)
        case .playing:
            Image(systemName: "waveform")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(RrradioTheme.accent)
        case .paused:
            Image(systemName: "pause.fill")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
        case .error:
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(RrradioTheme.ink3)
        case .idle:
            EmptyView()
        }
    }

    @ViewBuilder
    private var detailPane: some View {
        if player.current == nil {
            VStack(spacing: 14) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.system(size: 36, weight: .regular))
                    .foregroundStyle(RrradioTheme.accent)
                Text(locale.text(.noStation))
                    .font(.system(size: 24, weight: .medium))
                    .foregroundStyle(RrradioTheme.ink)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(32)
        } else {
            NowPlayingView(showsDismissButton: false)
        }
    }
}
