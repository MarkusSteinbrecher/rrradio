import MapKit
import SwiftUI

struct DashboardView: View {
    let stations: [Station]
    @Environment(\.dismiss) private var dismiss
    @State private var view: DashboardCountryView = .listeners
    @State private var stats = DashboardStats.loading
    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 30, longitude: 8),
            span: MKCoordinateSpan(latitudeDelta: 105, longitudeDelta: 170),
        ),
    )

    private let workerBase = URL(string: "https://rrradio-stats.markussteinbrecher.workers.dev")!

    private var activeCountryRows: [DashboardCountryRow] {
        stats.data?.countryRows(for: view) ?? []
    }

    private var activeCountryTotal: Int {
        activeCountryRows.reduce(0) { $0 + $1.count }
    }

    private var mapRows: [DashboardCountryRow] {
        Array(activeCountryRows.prefix(50))
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetChromeHeader(title: "Stats") { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Listener stats")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(RrradioTheme.ink)
                        .padding(.top, 18)

                    Text("Last 7 days . aggregate, anonymous")
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink4)
                        .padding(.top, 4)

                    kpis
                        .padding(.top, 18)

                    countrySection
                        .padding(.top, 22)

                    topStationsSection
                        .padding(.top, 22)

                    Text("Last 7 days . visits via GoatCounter . plays from anonymous play events . cached up to 1 hour.")
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(RrradioTheme.ink4)
                        .lineSpacing(3)
                        .padding(.top, 24)
                        .padding(.bottom, 28)
                }
                .padding(.horizontal, 24)
            }
        }
        .background(RrradioTheme.bg.ignoresSafeArea())
        .task {
            await loadStats()
        }
    }

    private var kpis: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4),
            spacing: 8,
        ) {
            kpi("Plays", value: stats.data?.totalPlays, muted: false)
            kpi("Visits", value: stats.data?.visits, muted: true)
            kpi("Countries", value: activeCountryRows.count, muted: false)
            kpi("Stations", value: stats.data?.totalStations, muted: false)
        }
    }

    private var countrySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                sectionTitle(view == .listeners ? "Where listeners are" : "Where stations are from")
                Spacer()
                countryToggle
            }

            dashboardMap

            dashboardTable(
                labelTitle: "Country",
                countTitle: view == .listeners ? "Visits" : "Plays",
                rows: activeCountryRows.map {
                    DashboardTableRow(
                        id: $0.code,
                        label: countryDisplayName($0.code),
                        count: $0.count,
                    )
                },
                empty: stats.emptyText(for: view),
            )
        }
    }

    private var topStationsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Top stations")
            dashboardTable(
                labelTitle: "Station",
                countTitle: "Plays",
                rows: stats.data?.topStations.map {
                    DashboardTableRow(id: $0.name, label: $0.name, count: $0.count)
                } ?? [],
                empty: stats.emptyText(for: .stations),
            )
        }
    }

    private var countryToggle: some View {
        HStack(spacing: 4) {
            toggleButton(.listeners, "Listeners")
            toggleButton(.stations, "Stations")
        }
        .padding(3)
        .background(RrradioTheme.bg2)
        .overlay(Capsule().stroke(RrradioTheme.line))
        .clipShape(Capsule())
    }

    private var dashboardMap: some View {
        ZStack {
            Map(position: $position) {
                ForEach(mapRows) { row in
                    if let coordinate = coordinate(forCountry: row.code) {
                        Annotation(row.code, coordinate: coordinate, anchor: .center) {
                            Circle()
                                .fill(RrradioTheme.accent.opacity(0.45))
                                .overlay(Circle().stroke(RrradioTheme.accent.opacity(0.85), lineWidth: 1))
                                .frame(width: markerSize(for: row), height: markerSize(for: row))
                                .accessibilityLabel("\(countryDisplayName(row.code)), \(row.count)")
                        }
                    }
                }
            }
            .mapStyle(.standard(elevation: .flat, emphasis: .muted))
            .mapControls {
                MapScaleView()
            }

            if activeCountryRows.isEmpty {
                Text(stats.emptyText(for: view))
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink3)
                    .multilineTextAlignment(.center)
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(RrradioTheme.bg.opacity(0.65))
            }
        }
        .aspectRatio(1.7, contentMode: .fit)
        .background(RrradioTheme.bg2)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(RrradioTheme.line))
    }

    private func kpi(_ label: String, value: Int?, muted: Bool) -> some View {
        VStack(spacing: 6) {
            Text(formatKpi(value))
                .font(.system(size: 26, weight: .medium))
                .fontDesign(.rounded)
                .foregroundStyle(muted ? RrradioTheme.ink3 : RrradioTheme.accent)
                .fontWeight(.medium)
                .lineLimit(1)
                .minimumScaleFactor(0.55)
            Text(label)
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.6)
                .foregroundStyle(RrradioTheme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.8)
            .foregroundStyle(RrradioTheme.ink3)
    }

    private func toggleButton(_ value: DashboardCountryView, _ label: String) -> some View {
        Button {
            withAnimation(.snappy) {
                view = value
            }
        } label: {
            Text(label)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .tracking(1.2)
                .foregroundStyle(view == value ? RrradioTheme.bg : RrradioTheme.ink3)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(view == value ? RrradioTheme.ink : .clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func dashboardTable(
        labelTitle: String,
        countTitle: String,
        rows: [DashboardTableRow],
        empty: String,
    ) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                tableHeader("#", width: 28, alignment: .leading)
                tableHeader(labelTitle, alignment: .leading)
                tableHeader("", width: 78, alignment: .leading)
                tableHeader(countTitle, width: 56, alignment: .trailing)
                tableHeader("%", width: 38, alignment: .trailing)
            }
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(RrradioTheme.line)
                    .frame(height: 1)
            }

            if rows.isEmpty {
                Text(empty)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(RrradioTheme.ink4)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                let maxCount = rows.first?.count ?? 1
                let total = rows.reduce(0) { $0 + $1.count }
                ForEach(Array(rows.prefix(12).enumerated()), id: \.element.id) { index, row in
                    dashboardTableRow(
                        index: index,
                        row: row,
                        maxCount: maxCount,
                        total: total,
                    )
                }
            }
        }
    }

    private func dashboardTableRow(
        index: Int,
        row: DashboardTableRow,
        maxCount: Int,
        total: Int,
    ) -> some View {
        HStack(spacing: 8) {
            Text(String(index + 1).leftPadded(to: 2))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink4)
                .frame(width: 28, alignment: .leading)

            Text(row.label)
                .font(.system(size: 13))
                .foregroundStyle(RrradioTheme.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            GeometryReader { proxy in
                Capsule()
                    .fill(RrradioTheme.bg3)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(RrradioTheme.accent)
                            .frame(width: proxy.size.width * CGFloat(row.count) / CGFloat(max(maxCount, 1)))
                    }
            }
            .frame(width: 78, height: 4)

            Text(row.count.formatted())
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink2)
                .frame(width: 56, alignment: .trailing)

            Text(formatShare(row.count, total: total))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(RrradioTheme.ink4)
                .frame(width: 38, alignment: .trailing)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(RrradioTheme.line)
                .frame(height: 1)
        }
    }

    private func tableHeader(_ text: String, width: CGFloat? = nil, alignment: Alignment) -> some View {
        Text(text)
            .font(.system(size: 9.5, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .tracking(1.6)
            .foregroundStyle(RrradioTheme.ink4)
            .frame(width: width, alignment: alignment)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: alignment)
    }

    private func markerSize(for row: DashboardCountryRow) -> CGFloat {
        let maxCount = max(activeCountryRows.first?.count ?? 1, 1)
        return 8 + sqrt(CGFloat(row.count) / CGFloat(maxCount)) * 22
    }

    private func coordinate(forCountry code: String) -> CLLocationCoordinate2D? {
        if let geo = stations.first(where: { $0.country?.uppercased() == code && validGeo($0.geo) != nil })?.geo,
           let valid = validGeo(geo) {
            return CLLocationCoordinate2D(latitude: valid.lat, longitude: valid.lon)
        }
        if let fallback = dashboardCountryCentroids[code] {
            return fallback
        }
        return nil
    }

    private func loadStats() async {
        stats = .loading
        async let top = fetchTopStationsOrEmpty()
        async let totals = fetchTotalsOrNil()
        async let locations = fetchLocationsOrEmpty()
        let data = await DashboardData(
            topStations: top.items,
            playsTotal: top.total,
            visits: totals?.total,
            locations: locations,
            catalog: stations,
        )
        stats = .loaded(data)
    }

    private func fetchTopStationsOrEmpty() async -> (items: [DashboardTopStation], total: Int?) {
        let url = workerBase.appending(path: "/api/public/top-stations")
            .appending(queryItems: [
                URLQueryItem(name: "days", value: "7"),
                URLQueryItem(name: "limit", value: "25"),
            ])
        do {
            let response: DashboardTopStationsResponse = try await fetch(url)
            return (
                response.items.filter { !$0.name.isEmpty },
                response.total,
            )
        } catch {
            return ([], nil)
        }
    }

    private func fetchTotalsOrNil() async -> DashboardTotalsResponse? {
        let url = workerBase.appending(path: "/api/public/totals")
            .appending(queryItems: [URLQueryItem(name: "days", value: "7")])
        return try? await fetch(url)
    }

    private func fetchLocationsOrEmpty() async -> [DashboardLocation] {
        let url = workerBase.appending(path: "/api/public/locations")
            .appending(queryItems: [
                URLQueryItem(name: "days", value: "7"),
                URLQueryItem(name: "limit", value: "50"),
            ])
        do {
            let response: DashboardLocationsResponse = try await fetch(url)
            return response.items
        } catch {
            return []
        }
    }

    private func fetch<T: Decodable>(_ url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func formatKpi(_ value: Int?) -> String {
        guard let value else {
            switch stats {
            case .loading: return "..."
            case .failed: return "-"
            case .loaded: return "-"
            }
        }
        return value > 0 ? value.formatted() : "-"
    }

    private func formatShare(_ count: Int, total: Int) -> String {
        guard total > 0 else { return "-" }
        let pct = Double(count) / Double(total) * 100
        if pct >= 10 { return "\(Int(pct.rounded()))%" }
        return String(format: "%.1f%%", pct)
    }
}

private enum DashboardCountryView {
    case listeners
    case stations
}

private enum DashboardStats {
    case loading
    case loaded(DashboardData)
    case failed

    var data: DashboardData? {
        if case .loaded(let data) = self { return data }
        return nil
    }

    func emptyText(for view: DashboardCountryView) -> String {
        switch self {
        case .loading:
            return "Loading stats..."
        case .failed:
            return "Stats unavailable"
        case .loaded:
            return view == .listeners ? "No listener-location data yet" : "No station-country data yet"
        }
    }
}

private struct DashboardData {
    let topStations: [DashboardTopStation]
    let totalPlays: Int
    let visits: Int?
    let byListenerCountry: [DashboardCountryRow]
    let byStationCountry: [DashboardCountryRow]

    var totalStations: Int { topStations.count }

    init(
        topStations: [DashboardTopStation],
        playsTotal: Int?,
        visits: Int?,
        locations: [DashboardLocation],
        catalog: [Station],
    ) {
        self.topStations = topStations.sorted { $0.count > $1.count }
        totalPlays = playsTotal ?? topStations.reduce(0) { $0 + $1.count }
        self.visits = visits

        let catalogByName = Dictionary(
            catalog.map { ($0.name.lowercased(), $0) },
            uniquingKeysWith: { first, _ in first },
        )
        byListenerCountry = Self.sortedRows(
            locations.reduce(into: [String: Int]()) { counts, location in
                counts[location.code.uppercased(), default: 0] += location.count
            },
        )
        byStationCountry = Self.sortedRows(
            topStations.reduce(into: [String: Int]()) { counts, item in
                guard let country = catalogByName[item.name.lowercased()]?.country?.uppercased() else { return }
                counts[country, default: 0] += item.count
            },
        )
    }

    func countryRows(for view: DashboardCountryView) -> [DashboardCountryRow] {
        view == .listeners ? byListenerCountry : byStationCountry
    }

    private static func sortedRows(_ counts: [String: Int]) -> [DashboardCountryRow] {
        counts
            .map { DashboardCountryRow(code: $0.key, count: $0.value) }
            .sorted {
                if $0.count != $1.count { return $0.count > $1.count }
                return countryDisplayName($0.code) < countryDisplayName($1.code)
            }
    }
}

private struct DashboardTopStationsResponse: Decodable {
    let items: [DashboardTopStation]
    let total: Int?
}

private struct DashboardLocationsResponse: Decodable {
    let items: [DashboardLocation]
}

private struct DashboardTotalsResponse: Decodable {
    let total: Int?
}

private struct DashboardTopStation: Decodable {
    let name: String
    let count: Int
}

private struct DashboardLocation: Decodable {
    let code: String
    let count: Int
}

private struct DashboardCountryRow: Identifiable {
    let code: String
    let count: Int

    var id: String { code }
}

private struct DashboardTableRow: Identifiable {
    let id: String
    let label: String
    let count: Int
}

private let dashboardCountryCentroids: [String: CLLocationCoordinate2D] = [
    "AT": CLLocationCoordinate2D(latitude: 47.6, longitude: 14.1),
    "BE": CLLocationCoordinate2D(latitude: 50.6, longitude: 4.7),
    "BR": CLLocationCoordinate2D(latitude: -10.8, longitude: -52.9),
    "CA": CLLocationCoordinate2D(latitude: 56.1, longitude: -106.3),
    "CH": CLLocationCoordinate2D(latitude: 46.8, longitude: 8.2),
    "DE": CLLocationCoordinate2D(latitude: 51.2, longitude: 10.5),
    "ES": CLLocationCoordinate2D(latitude: 40.4, longitude: -3.7),
    "FR": CLLocationCoordinate2D(latitude: 46.2, longitude: 2.2),
    "GB": CLLocationCoordinate2D(latitude: 54.7, longitude: -3.4),
    "IT": CLLocationCoordinate2D(latitude: 42.8, longitude: 12.5),
    "NL": CLLocationCoordinate2D(latitude: 52.1, longitude: 5.3),
    "US": CLLocationCoordinate2D(latitude: 39.8, longitude: -98.6),
]

func validGeo(_ geo: [Double]?) -> (lat: Double, lon: Double)? {
    guard let geo, geo.count >= 2 else { return nil }
    let lat = geo[0]
    let lon = geo[1]
    guard (-90...90).contains(lat), (-180...180).contains(lon) else { return nil }
    return (lat, lon)
}

func countryCounts(from stations: [Station], limit: Int? = nil) -> [(code: String, count: Int)] {
    var counts: [String: Int] = [:]
    for station in stations {
        guard let code = station.country?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
              code.count == 2 else {
            continue
        }
        counts[code, default: 0] += 1
    }

    let sorted = counts
        .map { (code: $0.key, count: $0.value) }
        .sorted { first, second in
            if first.count != second.count { return first.count > second.count }
            return countryDisplayName(first.code) < countryDisplayName(second.code)
        }

    if let limit {
        return Array(sorted.prefix(limit))
    }
    return sorted
}

private extension String {
    func leftPadded(to width: Int) -> String {
        let padding = max(0, width - count)
        return String(repeating: "0", count: padding) + self
    }
}

private extension URL {
    func appending(queryItems: [URLQueryItem]) -> URL {
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)
        components?.queryItems = queryItems
        return components?.url ?? self
    }
}
