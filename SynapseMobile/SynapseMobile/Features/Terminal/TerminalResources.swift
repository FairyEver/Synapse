import Foundation

struct TerminalResource: Identifiable, Hashable {
    enum Kind: Hashable {
        case link
        case webpage
        case image
        case file
    }

    let url: URL
    var kind: Kind = .link

    var id: String { url.absoluteString }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.url == rhs.url
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(url)
    }

    var name: String {
        let host = url.host ?? url.absoluteString
        let last = url.lastPathComponent.removingPercentEncoding ?? url.lastPathComponent
        return last.isEmpty || last == "/" ? host : "\(host) / \(last)"
    }
}

/// Collects links from physical terminal rows after a frame has been applied.
/// A row whose successor is a soft wrap waits for that successor, including when
/// the desktop splits one update into multiple frames.
struct TerminalResourceCollector {
    private static let pattern = try! NSRegularExpression(pattern: #"https?://[^\s<>"'`]+"#, options: .caseInsensitive)
    private static let trailing = CharacterSet(charactersIn: "，。！？；、,.!?;)）]}>")

    private var seen: Set<String> = []
    private(set) var resources: [TerminalResource] = []

    mutating func accept(_ frame: MobileTerminalFrame, lines: [Int: TerminalLine]) -> Bool {
        var examinedStarts: Set<Int> = []
        var changed = false
        for offset in frame.lines.indices {
            let index = frame.from + offset
            guard lines[index] != nil else { continue }
            var start = index
            while let current = lines[start], current.wrappedFromPrevious,
                  let previous = lines[start - 1], previous.wrappedToNext {
                start -= 1
            }
            // The phone has only the tail of this wrapped row; wait for history.
            if lines[start]?.wrappedFromPrevious == true, lines[start - 1] == nil { continue }
            guard examinedStarts.insert(start).inserted else { continue }

            var text = ""
            var end = start
            while let line = lines[end] {
                text += line.text
                if !line.wrappedToNext { break }
                guard lines[end + 1]?.wrappedFromPrevious == true else {
                    text = "" // A continuation frame has not arrived yet.
                    break
                }
                end += 1
            }
            guard !text.isEmpty else { continue }
            for url in Self.urls(in: text) where seen.insert(url.absoluteString).inserted {
                resources.insert(TerminalResource(url: url), at: 0)
                changed = true
            }
        }
        return changed
    }

    mutating func setKind(_ kind: TerminalResource.Kind, for url: URL) {
        guard let index = resources.firstIndex(where: { $0.url == url }) else { return }
        resources[index].kind = kind
    }

    private static func urls(in text: String) -> [URL] {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return pattern.matches(in: text, range: range).compactMap { match in
            guard let matchRange = Range(match.range, in: text) else { return nil }
            let candidate = String(text[matchRange]).trimmingCharacters(in: trailing)
            guard let url = URL(string: candidate),
                  let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
                  let host = url.host, !host.isEmpty else { return nil }
            return url
        }
    }
}
