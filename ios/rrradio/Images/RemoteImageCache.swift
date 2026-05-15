import SwiftUI
import UIKit

@MainActor
final class RemoteImageCache {
    static let shared = RemoteImageCache()

    nonisolated static let defaultMaximumBytes = 5_000_000
    nonisolated static let defaultTimeout: TimeInterval = 15

    private let cache = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]

    private init() {
        cache.countLimit = 800
        cache.totalCostLimit = 32 * 1024 * 1024
    }

    func cachedImage(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    func image(
        for url: URL,
        maximumBytes: Int = RemoteImageCache.defaultMaximumBytes,
        timeout: TimeInterval = RemoteImageCache.defaultTimeout,
    ) async -> UIImage? {
        if let cached = cachedImage(for: url) {
            return cached
        }
        if let task = inFlight[url] {
            return await task.value
        }

        let task = Task.detached(priority: .utility) { () async -> UIImage? in
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.timeoutInterval = timeout

            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                    return nil
                }
                if response.expectedContentLength > Int64(maximumBytes) {
                    return nil
                }

                var data = Data()
                data.reserveCapacity(min(maximumBytes, 256 * 1024))
                for try await byte in bytes {
                    data.append(byte)
                    if data.count > maximumBytes {
                        return nil
                    }
                }

                guard let image = UIImage(data: data) else { return nil }
                return await image.byPreparingForDisplay() ?? image
            } catch {
                return nil
            }
        }

        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image {
            cache.setObject(image, forKey: url as NSURL, cost: image.cacheCost)
        }
        return image
    }
}

struct CachedRemoteImage<Content: View, Placeholder: View>: View {
    let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    @State private var image: UIImage?

    init(
        url: URL?,
        @ViewBuilder content: @escaping (Image) -> Content,
        @ViewBuilder placeholder: @escaping () -> Placeholder,
    ) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let image = image ?? cachedImage {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    @MainActor
    private var cachedImage: UIImage? {
        guard let url else { return nil }
        return RemoteImageCache.shared.cachedImage(for: url)
    }

    @MainActor
    private func loadImage() async {
        guard let url else {
            image = nil
            return
        }
        if let cached = RemoteImageCache.shared.cachedImage(for: url) {
            image = cached
            return
        }
        let loaded = await RemoteImageCache.shared.image(for: url)
        guard !Task.isCancelled else { return }
        image = loaded
    }
}

private extension UIImage {
    var cacheCost: Int {
        guard let cgImage else { return 1 }
        return cgImage.bytesPerRow * cgImage.height
    }
}
