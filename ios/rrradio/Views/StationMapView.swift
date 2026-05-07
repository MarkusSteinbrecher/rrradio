import MapKit
import SwiftUI

struct StationMapView: View {
    let stations: [Station]
    @Binding var selectedCountry: String?
    let onSelectCountry: (String?) -> Void
    let onOpenStation: (Station) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(LocaleController.self) private var locale
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 30, longitude: 8),
            span: MKCoordinateSpan(latitudeDelta: 105, longitudeDelta: 170),
        ),
    )
    @State private var visibleLatitudeDelta: CLLocationDegrees = 105
    @State private var visibleRegion: MKCoordinateRegion?

    private var mappedStations: [Station] {
        stations.filter { validGeo($0.geo) != nil }
    }

    private var shouldShowStationPins: Bool {
        visibleLatitudeDelta < 7
    }

    private var mapStations: [Station] {
        let visible = visibleRegion.map { region in
            mappedStations.filter { station in
                coordinate(for: station).map { region.contains($0) } ?? false
            }
        } ?? mappedStations
        return Array(visible.prefix(70))
    }

    private var showsLogoPins: Bool {
        visibleLatitudeDelta < 2.5 && mapStations.count <= 35
    }

    private var countryRows: [(code: String, count: Int)] {
        countryCounts(from: mappedStations)
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: locale.text(.map), titleAlignment: .center) { dismiss() }

            VStack(alignment: .leading, spacing: 0) {
                mapView

                countryList
            }
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    private var mapView: some View {
        Map(position: $position) {
            if shouldShowStationPins {
                ForEach(mapStations) { station in
                    if let coordinate = coordinate(for: station) {
                        Annotation(station.name, coordinate: coordinate, anchor: .center) {
                            Button {
                                onOpenStation(station)
                                dismiss()
                            } label: {
                                StationMapPin(
                                    favicon: station.favicon,
                                    fill: pinFill(for: station),
                                    size: pinSize(for: station),
                                    showsLogo: shouldShowLogoPin(for: station),
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Open \(station.name)")
                        }
                    }
                }
            } else {
                ForEach(countryRows.prefix(100), id: \.code) { row in
                    if let coordinate = countryCoordinate(row.code) {
                        Annotation(row.code, coordinate: coordinate, anchor: .center) {
                            Button {
                                onSelectCountry(row.code)
                                focusCountry(row.code)
                            } label: {
                                CountryMapPin(
                                    code: row.code,
                                    count: row.count,
                                    fill: row.code == selectedCountry ? RrradioTheme.accent : RrradioTheme.ink2,
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(countryDisplayName(row.code)), \(row.count) stations")
                        }
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, emphasis: .muted))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .onMapCameraChange(frequency: .onEnd) { context in
            visibleLatitudeDelta = context.region.span.latitudeDelta
            visibleRegion = context.region
        }
        .frame(height: 280)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(RrradioTheme.line))
        .padding(.horizontal, 24)
    }

    private var countryList: some View {
        ScrollView {
            VStack(spacing: 0) {
                Button {
                    onSelectCountry(nil)
                    focusWorld()
                } label: {
                    HStack {
                        Text("All countries")
                        Spacer()
                        if selectedCountry == nil {
                            Image(systemName: "checkmark")
                                .foregroundStyle(RrradioTheme.accent)
                        }
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(RrradioTheme.ink2)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.plain)

                ForEach(countryRows.prefix(80), id: \.code) { row in
                    Button {
                        onSelectCountry(row.code)
                        focusCountry(row.code)
                    } label: {
                        HStack(spacing: 12) {
                            Text(row.code)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(RrradioTheme.ink4)
                                .frame(width: 28, alignment: .leading)
                            Text(countryDisplayName(row.code))
                                .foregroundStyle(RrradioTheme.ink2)
                            Spacer()
                            Text(row.count.formatted())
                                .foregroundStyle(RrradioTheme.ink4)
                            if selectedCountry == row.code {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(RrradioTheme.accent)
                            }
                        }
                        .font(.system(size: 13))
                        .padding(.vertical, 11)
                        .overlay(alignment: .top) {
                            Rectangle()
                                .fill(RrradioTheme.line)
                                .frame(height: 1)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
    }

    private func coordinate(for station: Station) -> CLLocationCoordinate2D? {
        guard let geo = validGeo(station.geo) else { return nil }
        return CLLocationCoordinate2D(latitude: geo.lat, longitude: geo.lon)
    }

    private func pinFill(for station: Station) -> Color {
        station.country?.uppercased() == selectedCountry ? RrradioTheme.accent : RrradioTheme.ink2
    }

    private func pinSize(for station: Station) -> CGFloat {
        if shouldShowLogoPin(for: station) {
            return station.country?.uppercased() == selectedCountry ? 34 : 30
        }
        return station.country?.uppercased() == selectedCountry ? 18 : 14
    }

    private func shouldShowLogoPin(for station: Station) -> Bool {
        station.favicon != nil && showsLogoPins
    }

    private func countryCoordinate(_ code: String) -> CLLocationCoordinate2D? {
        let coordinates = mappedStations
            .filter { $0.country?.uppercased() == code }
            .compactMap(coordinate)
        guard !coordinates.isEmpty else { return nil }
        return CLLocationCoordinate2D(
            latitude: coordinates.map(\.latitude).reduce(0, +) / Double(coordinates.count),
            longitude: coordinates.map(\.longitude).reduce(0, +) / Double(coordinates.count),
        )
    }

    private func focusCountry(_ code: String) {
        let coordinates = mappedStations
            .filter { $0.country?.uppercased() == code }
            .compactMap(coordinate)
        guard !coordinates.isEmpty else { return }

        let minLat = coordinates.map(\.latitude).min() ?? 0
        let maxLat = coordinates.map(\.latitude).max() ?? 0
        let minLon = coordinates.map(\.longitude).min() ?? 0
        let maxLon = coordinates.map(\.longitude).max() ?? 0
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLon + maxLon) / 2,
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max(maxLat - minLat, 4) * 1.8,
            longitudeDelta: max(maxLon - minLon, 4) * 1.8,
        )
        position = .region(MKCoordinateRegion(center: center, span: span))
    }

    private func focusWorld() {
        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 30, longitude: 8),
            span: MKCoordinateSpan(latitudeDelta: 105, longitudeDelta: 170),
        )
        position = .region(region)
        visibleLatitudeDelta = region.span.latitudeDelta
        visibleRegion = region
    }
}

private struct StationMapPin: View {
    let favicon: URL?
    let fill: Color
    let size: CGFloat
    let showsLogo: Bool

    var body: some View {
        ZStack {
            if showsLogo, let favicon {
                AsyncImage(url: favicon) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        Circle()
                            .fill(fill)
                    }
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
                .overlay(Circle().stroke(RrradioTheme.bg.opacity(0.82), lineWidth: 2))
                .overlay(Circle().stroke(fill.opacity(0.35), lineWidth: 1))
            } else {
                Circle()
                    .fill(fill)
                    .frame(width: size, height: size)
                    .overlay(Circle().stroke(RrradioTheme.bg.opacity(0.72), lineWidth: 1.5))
            }
        }
        .shadow(color: .black.opacity(showsLogo ? 0.18 : 0.08), radius: showsLogo ? 3 : 1, y: 1)
    }
}

private struct CountryMapPin: View {
    let code: String
    let count: Int
    let fill: Color

    var body: some View {
        HStack(spacing: 5) {
            Text(code)
            Text(count.formatted())
                .foregroundStyle(RrradioTheme.bg.opacity(0.72))
        }
        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
        .foregroundStyle(RrradioTheme.bg)
        .padding(.horizontal, 7)
        .padding(.vertical, 5)
        .background(fill)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(RrradioTheme.bg.opacity(0.72), lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
    }
}

private extension MKCoordinateRegion {
    func contains(_ coordinate: CLLocationCoordinate2D) -> Bool {
        let latRadius = span.latitudeDelta / 2
        let lonRadius = span.longitudeDelta / 2
        let minLat = center.latitude - latRadius
        let maxLat = center.latitude + latRadius
        let minLon = center.longitude - lonRadius
        let maxLon = center.longitude + lonRadius
        return (minLat...maxLat).contains(coordinate.latitude)
            && (minLon...maxLon).contains(coordinate.longitude)
    }
}
