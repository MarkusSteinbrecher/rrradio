import SwiftUI
import UIKit

@MainActor
final class RemoteImageCache {
    static let shared = RemoteImageCache()

    nonisolated static let defaultMaximumBytes = 5_000_000
    nonisolated static let defaultTimeout: TimeInterval = 15

    private let cache = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<RemoteImageLoadResult, Never>] = [:]
    private var invalidImageURLs: Set<URL> = []

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
        if invalidImageURLs.contains(url) {
            return nil
        }
        if let task = inFlight[url] {
            return image(from: await task.value, for: url)
        }

        let task = Task.detached(priority: .utility) { () async -> RemoteImageLoadResult in
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.timeoutInterval = timeout

            do {
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                    return .unavailable
                }
                guard Self.isSupportedImageResponse(response) else {
                    return .invalidImage
                }
                if response.expectedContentLength > Int64(maximumBytes) {
                    return .invalidImage
                }

                var data = Data()
                data.reserveCapacity(min(maximumBytes, 256 * 1024))
                for try await byte in bytes {
                    data.append(byte)
                    if data.count > maximumBytes {
                        return .invalidImage
                    }
                }

                guard Self.hasSupportedImageSignature(data) else {
                    return .invalidImage
                }
                guard let image = UIImage(data: data),
                      image.size.width > 0,
                      image.size.height > 0,
                      let prepared = await image.byPreparingForDisplay() else {
                    return .invalidImage
                }
                return .image(prepared)
            } catch {
                return .unavailable
            }
        }

        inFlight[url] = task
        let result = await task.value
        inFlight[url] = nil
        return image(from: result, for: url)
    }

    private func image(from result: RemoteImageLoadResult, for url: URL) -> UIImage? {
        switch result {
        case .image(let image):
            invalidImageURLs.remove(url)
            cache.setObject(image, forKey: url as NSURL, cost: image.cacheCost)
            return image
        case .invalidImage:
            invalidImageURLs.insert(url)
            return nil
        case .unavailable:
            return nil
        }
    }

    nonisolated private static func isSupportedImageResponse(_ response: URLResponse) -> Bool {
        guard let mimeType = response.mimeType?.lowercased() else {
            return true
        }
        switch mimeType {
        case "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif":
            return true
        default:
            return false
        }
    }

    nonisolated private static func hasSupportedImageSignature(_ data: Data) -> Bool {
        let bytes = Array(data.prefix(16))
        guard bytes.count >= 4 else { return false }

        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) {
            return true
        }
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) {
            return true
        }
        if bytes.starts(with: [0x47, 0x49, 0x46, 0x38]) {
            return true
        }
        if bytes.count >= 12,
           bytes[0...3].elementsEqual([0x52, 0x49, 0x46, 0x46]),
           bytes[8...11].elementsEqual([0x57, 0x45, 0x42, 0x50]) {
            return true
        }
        if bytes.count >= 12,
           bytes[4...7].elementsEqual([0x66, 0x74, 0x79, 0x70]) {
            return true
        }
        return false
    }
}

private enum RemoteImageLoadResult {
    case image(UIImage)
    case invalidImage
    case unavailable
}

struct CachedRemoteImage<Content: View, Placeholder: View>: View {
    let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    @State private var image: UIImage?
    @State private var imageURL: URL?

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
            if let image = currentImage {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .transaction { transaction in
            transaction.animation = nil
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
    private var currentImage: UIImage? {
        if imageURL == url, let image {
            return image
        }
        return cachedImage
    }

    @MainActor
    private func loadImage() async {
        guard let url else {
            image = nil
            imageURL = nil
            return
        }
        if let cached = RemoteImageCache.shared.cachedImage(for: url) {
            image = cached
            imageURL = url
            return
        }
        image = nil
        imageURL = nil
        let loaded = await RemoteImageCache.shared.image(for: url)
        guard !Task.isCancelled else { return }
        guard self.url == url else { return }
        image = loaded
        imageURL = loaded == nil ? nil : url
    }
}

private extension UIImage {
    var cacheCost: Int {
        guard let cgImage else { return 1 }
        return cgImage.bytesPerRow * cgImage.height
    }
}
