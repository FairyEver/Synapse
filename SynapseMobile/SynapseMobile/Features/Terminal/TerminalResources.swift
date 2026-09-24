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
///
/// Two kinds of row have to be put back together before a link can be read off them.
/// One the terminal made itself: a row whose successor is a soft wrap waits for that
/// successor, including when the desktop splits one update into multiple frames.
///
/// The other one the program at the far end made. Claude Code's TUI wraps its own text
/// and indents the continuation, so a URL too long for the columns left on its row
/// arrives as two rows the terminal never marks as wrapped — the wire flags stay 0, the
/// first half reads as a whole line, and the reader is handed a link that 404s. Where
/// the flags are silent the shape speaks: the row a token was cut in was filled to the
/// grid's last column, and the row below opens with the hanging indent and the rest of
/// the URL.
struct TerminalResourceCollector {
    private static let pattern = try! NSRegularExpression(pattern: #"https?://[^\s<>"'`]+"#, options: .caseInsensitive)
    private static let trailing = CharacterSet(charactersIn: "，。！？；、,.!?;)）]}>")
    /// Characters URL text keeps going with. A cut token's tail is made of these; a
    /// fresh line of prose is not.
    private static let urlBody = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~%!$&'()*+,;=:@/?#[]"
    )
    /// The deepest hanging indent a wrapped row is expected to carry. Past it the row
    /// is more likely a nested block than the tail of the row above.
    private static let deepestHangingIndent = 8

    private var seen: Set<String> = []
    /// Rows whose link is not collected yet because the row they continue into has not
    /// arrived. They are looked at again when it does, so half a URL is never offered.
    private var waiting: Set<Int> = []
    private(set) var resources: [TerminalResource] = []

    mutating func accept(_ frame: MobileTerminalFrame, lines: [Int: TerminalLine], columns: Int) -> Bool {
        var starts: Set<Int> = []
        for offset in frame.lines.indices {
            let index = frame.from + offset
            guard lines[index] != nil else { continue }
            var start = index
            while start > 0, let current = lines[start], let previous = lines[start - 1],
                  Self.continues(previous: previous, next: current, columns: columns) {
                start -= 1
            }
            // The phone has only the tail of this wrapped row; wait for history.
            if lines[start]?.wrappedFromPrevious == true, lines[start - 1] == nil { continue }
            starts.insert(start)
        }
        waiting = waiting.filter { lines[$0] != nil }
        starts.formUnion(waiting)

        var changed = false
        for start in starts.sorted() {
            guard let text = Self.assembly(from: start, lines: lines, columns: columns) else {
                waiting.insert(start)
                continue
            }
            waiting.remove(start)
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

    /// The text of the row at `start` with every row it continues into, or nil while one
    /// of them has not arrived yet.
    private static func assembly(from start: Int, lines: [Int: TerminalLine], columns: Int) -> String? {
        guard let first = lines[start] else { return nil }
        var text = first.text
        var line = first
        var end = start
        while mayContinue(text, row: line, columns: columns) {
            guard let next = lines[end + 1] else { return nil }
            guard continues(previous: line, next: next, columns: columns) else { break }
            // A soft-wrapped row carries its text and nothing else. A hanging one carries
            // the indent the TUI gave it, which is layout rather than content.
            text += line.wrappedToNext && next.wrappedFromPrevious ? next.text : withoutHangingIndent(next.text)
            line = next
            end += 1
        }
        return text
    }

    /// Whether the row can have a successor on the row below it. The terminal's own
    /// answer is the flag; the TUI's is a row that ends in the middle of a URL and was
    /// filled to the last column doing it.
    private static func mayContinue(_ text: String, row: TerminalLine, columns: Int) -> Bool {
        if row.wrappedToNext { return true }
        return endsInsideURL(text) && fillsGrid(row.text, columns: columns)
    }

    /// Whether `next` is the row `previous` continues into.
    private static func continues(previous: TerminalLine, next: TerminalLine, columns: Int) -> Bool {
        if previous.wrappedToNext && next.wrappedFromPrevious { return true }
        guard holdsURLTail(previous.text), fillsGrid(previous.text, columns: columns) else { return false }
        return opensWithURLTail(next.text)
    }

    /// Whether the row is URL text a break could have landed inside: the head of a cut,
    /// which ends in a URL, or one of its middle rows, which are URL text all the way.
    private static func holdsURLTail(_ text: String) -> Bool {
        endsInsideURL(text) || opensWithURLTail(text)
    }

    /// Whether `text` ends in the middle of a URL — its last URL match runs to the very
    /// end, with nothing after it.
    private static func endsInsideURL(_ text: String) -> Bool {
        guard !text.isEmpty else { return false }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = pattern.matches(in: text, range: range).last,
              let matched = Range(match.range, in: text) else { return false }
        return matched.upperBound == text.endIndex
    }

    /// Whether the row was filled to the grid's last column — what a token cut in the
    /// middle looks like. A row the TUI broke at a space is ragged instead, and that
    /// difference is the whole of telling half a URL from a whole one.
    private static func fillsGrid(_ text: String, columns: Int) -> Bool {
        guard columns > 0 else { return false }
        var cells = 0
        for character in text {
            cells += TerminalStore.cellWidth(of: character)
            if cells >= columns { return true }
        }
        return false
    }

    /// Whether the row opens with URL text after a hanging indent — the shape the TUI
    /// leaves on the row a long token continues into.
    private static func opensWithURLTail(_ text: String) -> Bool {
        let body = text.drop { $0 == " " || $0 == "\t" }
        let indent = text.count - body.count
        guard indent > 0, indent <= deepestHangingIndent,
              let first = body.first, let scalar = first.unicodeScalars.first else { return false }
        return urlBody.contains(scalar)
    }

    private static func withoutHangingIndent(_ text: String) -> String {
        String(text.drop { $0 == " " || $0 == "\t" })
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
