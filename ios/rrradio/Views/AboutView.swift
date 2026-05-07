import SwiftUI

struct AboutView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: "About") { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("r r r a d i o . o r g")
                            .font(.system(size: 30, weight: .medium))
                            .foregroundStyle(RrradioTheme.ink)
                        Text("Minimal, ad-free internet radio.")
                            .font(.system(size: 15))
                            .foregroundStyle(RrradioTheme.ink3)
                    }

                    aboutSection("What it is") {
                        Text("A simple player for curated stations plus thousands more from the Radio Browser catalog. The iOS app currently uses the same hosted station catalog as the web app.")
                    }

                    aboutSection("Features") {
                        featureRow("magnifyingglass", "Browse & search", "Find stations by name, genre, country, and tags.")
                        featureRow("heart", "Favorites", "Save stations locally on this device.")
                        featureRow("clock", "Recents", "Return quickly to stations you played.")
                        featureRow("moon.zzz", "Sleep timer", "Cycle through the same sleep durations as the web app.")
                        featureRow("music.note", "Now playing", "Show track metadata when the station exposes it.")
                        featureRow("plus", "Custom stations", "Add your own HTTPS stream URL.")
                    }

                    aboutSection("Signal stars") {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("* verified stream")
                            Text("** current track")
                            Text("*** program and richer metadata")
                        }
                    }

                    aboutSection("Privacy") {
                        Text("The native app keeps favorites, recents, custom stations, and cached catalog data on device. It does not need an account.")
                    }
                }
                .font(.system(size: 14))
                .foregroundStyle(RrradioTheme.ink2)
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 32)
            }
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    private func aboutSection<Content: View>(
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
                .lineSpacing(3)
        }
    }

    private func featureRow(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(RrradioTheme.accent)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(RrradioTheme.ink3)
            }
        }
    }
}

struct SheetChromeHeader: View {
    let title: String
    let dismiss: () -> Void

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.6)
                .foregroundStyle(RrradioTheme.ink3)
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(RrradioTheme.ink2)
                    .frame(width: 36, height: 36)
                    .overlay(Circle().stroke(RrradioTheme.line))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.leading, 24)
        .padding(.trailing, 12)
        .padding(.vertical, 10)
        .background(RrradioTheme.bg)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }
}
