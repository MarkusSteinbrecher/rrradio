import SwiftUI
import UIKit
import XCTest
@testable import rrradio

@MainActor
final class ListeningHistoryViewTests: XCTestCase {
    private var temporaryFiles: [URL] = []
    private var window: UIWindow?

    override func tearDown() {
        window?.isHidden = true
        window = nil
        for url in temporaryFiles {
            try? FileManager.default.removeItem(at: url)
        }
        temporaryFiles = []
        super.tearDown()
    }

    func testListeningHistoryDashboardMountsWithLongHistoryRange() {
        let history = makeHistory()
        history.isEnabled = true
        history.retention = .forever
        seedLongHistory(in: history)

        let view = ListeningHistoryPageView()
            .environment(history)
            .environment(Catalog())
        let controller = UIHostingController(rootView: view)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window

        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        XCTAssertNotNil(controller.view.window)
    }

    func testListeningHistoryDashboardMountsWithSingleSnapshot() {
        let history = makeHistory()
        history.isEnabled = true
        history.retention = .forever
        let start = Date().addingTimeInterval(-600)
        history.startSession(for: station(id: "single", name: "Single FM", country: "CH"), at: start)
        history.closeActiveSession(at: start.addingTimeInterval(300))

        let view = ListeningHistoryPageView()
            .environment(history)
            .environment(Catalog())
        let controller = UIHostingController(rootView: view)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window

        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()

        XCTAssertNotNil(controller.view.window)
    }

    private func seedLongHistory(in history: ListeningHistory) {
        let calendar = Calendar(identifier: .gregorian)
        let stationA = station(id: "alpha", name: "Alpha Radio", country: "CH")
        let stationB = station(id: "beta", name: "Beta FM", country: "DE")

        for year in 2020...2026 {
            guard let start = calendar.date(from: DateComponents(year: year, month: 1, day: 1, hour: 9)) else {
                continue
            }
            let station = year.isMultiple(of: 2) ? stationA : stationB
            history.startSession(for: station, at: start)
            history.closeActiveSession(at: start.addingTimeInterval(TimeInterval(year - 2019) * 600))
        }
    }

    private func makeHistory() -> ListeningHistory {
        let suiteName = "org.rrradio.view-tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        let url = FileManager.default.temporaryDirectory
            .appending(path: "rrradio-listening-history-view-\(UUID().uuidString).json")
        temporaryFiles.append(url)
        return ListeningHistory(defaults: defaults, recordsURL: url)
    }

    private func station(id: String, name: String, country: String?) -> Station {
        Station(
            id: id,
            name: name,
            streamUrl: URL(string: "https://example.com/\(id).mp3")!,
            country: country,
        )
    }
}
