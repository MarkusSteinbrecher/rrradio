import Foundation

func streamQualityMeter(codec: String?, bitrate: Int?) -> String {
    String(repeating: "▮", count: streamQualityLevel(codec: codec, bitrate: bitrate))
}

func streamQualityLevel(codec: String?, bitrate: Int?) -> Int {
    let normalizedCodec = codec?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""

    if ["flac", "alac", "wav", "pcm"].contains(normalizedCodec) {
        return 4
    }

    guard let bitrate, bitrate > 0 else { return 1 }

    if normalizedCodec.contains("aac") || normalizedCodec.contains("opus") {
        if bitrate >= 128 { return 4 }
        if bitrate >= 96 { return 3 }
        if bitrate >= 64 { return 2 }
        return 1
    }

    if normalizedCodec.contains("mp3") || normalizedCodec.contains("mpeg") {
        if bitrate >= 192 { return 4 }
        if bitrate >= 128 { return 3 }
        if bitrate >= 96 { return 2 }
        return 1
    }

    if bitrate >= 192 { return 4 }
    if bitrate >= 128 { return 3 }
    if bitrate >= 96 { return 2 }
    return 1
}
