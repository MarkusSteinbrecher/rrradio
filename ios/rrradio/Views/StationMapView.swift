import MapKit
import SwiftUI

struct StationMapView: View {
    let stations: [Station]
    @Binding var selectedCountry: String?
    @Environment(\.dismiss) private var dismiss
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 30, longitude: 8),
            span: MKCoordinateSpan(latitudeDelta: 105, longitudeDelta: 170),
        ),
    )

    private var mappedStations: [Station] {
        stations.filter { validGeo($0.geo) != nil }
    }

    private var mapStations: [Station] {
        Array(mappedStations.prefix(900))
    }

    private var countryRows: [(code: String, count: Int)] {
        countryCounts(from: mappedStations)
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: "Map") { dismiss() }

            VStack(alignment: .leading, spacing: 0) {
                Text("Pan and zoom the station map, or tap a country below to filter the catalog.")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink4)
                    .lineSpacing(3)
                    .padding(.horizontal, 24)
                    .padding(.top, 18)
                    .padding(.bottom, 14)

                mapView

                countryList
            }
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
    }

    private var mapView: some View {
        Map(position: $position) {
            ForEach(mapStations) { station in
                if let coordinate = coordinate(for: station) {
                    Annotation(station.name, coordinate: coordinate, anchor: .center) {
                        Button {
                            if let country = station.country?.uppercased() {
                                selectedCountry = country
                                dismiss()
                            }
                        } label: {
                            ZStack {
                                Circle()
                                    .fill(pinFill(for: station))
                                    .frame(width: pinSize(for: station), height: pinSize(for: station))
                                Circle()
                                    .stroke(RrradioTheme.bg.opacity(0.72), lineWidth: 1)
                                    .frame(width: pinSize(for: station) + 2, height: pinSize(for: station) + 2)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Filter by \(station.country?.uppercased() ?? "station country")")
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, emphasis: .muted))
        .mapControls {
            MapCompass()
            MapScaleView()
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
                    selectedCountry = nil
                    dismiss()
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
                        selectedCountry = row.code
                        focusCountry(row.code)
                        dismiss()
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
        station.country?.uppercased() == selectedCountry ? 10 : 7
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
}
