import Foundation

struct TerminalResource: Identifiable, Hashable {
    let url: URL
    /// Other valid URL boundaries when a TUI inserted an unmarked hard line break.
    let alternatives: [URL]
    let needsConfirmation: Bool

    var id: String { url.absoluteString }
    var candidateURLs: [URL] { [url] + alternatives }

    var name: String {
        if TerminalResourceCollector.shareRootID(url) != nil { return "云盘分享" }
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
/// the flags are silent, a full row followed by a hanging indent suggests a possible
/// continuation. Valid URL boundaries are retained for the user to choose from.
///
/// An address that only means something on the desktop is not collected at all. A dev
/// server announces itself as `http://localhost:5173` and the API next to it as
/// `http://127.0.0.1:3000`; on the phone both of those are the phone, so a tap opens a
/// page that never loads. The row would sit in the list looking exactly like a real
/// resource, which is worse than not being there: the list is only worth reading if
/// everything on it can be opened.
struct TerminalResourceCollector {
    /// The system detector ends a link at prose punctuation, including Chinese
    /// punctuation. A non-whitespace regex swallowed "），原分享链接不变" as URL text.
    private static let detector = try! NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    private static let closingDelimiters: [Character: Character] = [")": "(", "）": "（", "]": "[", "}": "{"]
    /// ASCII URL characters. Unicode letters can also continue a path; without
    /// wrap metadata either spelling is treated as a candidate, not a certain link.
    private static let urlBody = CharacterSet(
        charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~%!$&'()*+,;=:@/?#[]"
    )
    /// The deepest hanging indent a wrapped row is expected to carry. Past it the row
    /// is more likely a nested block than the tail of the row above.
    private static let deepestHangingIndent = 8

    private struct Assembly {
        let text: String
        let end: Int
        /// UTF-16 offsets where rows were joined without a terminal wrap flag.
        let hardBreaks: [Int]
        /// A link reaching the grid edge may still continue even when the next row
        /// does not have the expected hanging indent.
        let uncertainEnd: Bool
    }

    private struct Occurrence {
        let end: Int
        let ids: Set<String>
    }

    /// A terminal suffix can rewrite a row in place. Keep its links tied to the
    /// physical rows until those rows are replaced; a screen reset archives them as
    /// session history instead of making a brief TUI rewrite permanent history.
    private var occurrences: [Int: Occurrence] = [:]
    private var archivedIDs: Set<String> = []
    /// Rows whose link is not collected yet because the row they continue into has not
    /// arrived. They are looked at again when it does, so half a URL is never offered.
    private var waiting: Set<Int> = []
    private(set) var resources: [TerminalResource] = []

    mutating func accept(_ frame: MobileTerminalFrame, lines: [Int: TerminalLine], columns: Int) -> Bool {
        var starts: Set<Int> = []
        if frame.isReset {
            archivedIDs.formUnion(resources.map(\.id))
            occurrences.removeAll()
        } else {
            let lastChanged = frame.from + frame.lines.count - 1
            let invalidated = occurrences.compactMap { start, occurrence -> (Int, Occurrence, Bool)? in
                let wasRewritten = !frame.lines.isEmpty && start <= lastChanged && occurrence.end >= frame.from
                let hasDisappeared = lines[start] == nil || lines[occurrence.end] == nil
                guard wasRewritten || hasDisappeared else { return nil }
                return (start, occurrence, hasDisappeared)
            }
            // Mutate after the scan: an iterator retaining the dictionary's storage
            // would copy all retained occurrences on its first removal.
            for (start, occurrence, hasDisappeared) in invalidated {
                if hasDisappeared && start < frame.from {
                    archivedIDs.formUnion(occurrence.ids)
                }
                occurrences.removeValue(forKey: start)
                if lines[start] != nil { starts.insert(start) }
            }
        }
        var previousStart: Int?
        for offset in frame.lines.indices {
            let index = frame.from + offset
            guard lines[index] != nil else {
                previousStart = nil
                continue
            }
            var start = index
            while start > 0, let current = lines[start], let previous = lines[start - 1],
                  Self.continues(previous: previous, next: current, columns: columns) {
                // Consecutive rows in this frame share the resolved head. Walking
                // back from every row makes a long wrapped line quadratic.
                if start == index, let previousStart {
                    start = previousStart
                    break
                }
                start -= 1
            }
            previousStart = start
            // The phone has only the tail of this wrapped row; wait for history.
            if lines[start]?.wrappedFromPrevious == true, lines[start - 1] == nil { continue }
            starts.insert(start)
        }
        waiting = waiting.filter { lines[$0] != nil }
        starts.formUnion(waiting)

        var changed = false
        var listedIDs = Set(resources.map(\.id))
        for start in starts.sorted() {
            guard let assembly = Self.assembly(from: start, lines: lines, columns: columns) else {
                waiting.insert(start)
                continue
            }
            waiting.remove(start)
            var ids: Set<String> = []
            for resource in Self.resources(in: assembly) {
                // Only this server's share URLs can replace a truncated share ID.
                // Other links must not scan the entire resource history twice.
                if Self.shareRootID(resource.url) != nil {
                    if resources.contains(where: { Self.isIncompleteSharePrefix(resource.url, of: $0.url) }) {
                        continue
                    }
                    let incomplete = resources.filter { Self.isIncompleteSharePrefix($0.url, of: resource.url) }
                    if !incomplete.isEmpty {
                        let removedIDs = Set(incomplete.map(\.id))
                        resources.removeAll { removedIDs.contains($0.id) }
                        listedIDs.subtract(removedIDs)
                        archivedIDs.subtract(removedIDs)
                        changed = true
                    }
                }
                ids.insert(resource.id)
                guard listedIDs.insert(resource.id).inserted else { continue }
                resources.insert(resource, at: 0)
                changed = true
            }
            // Ordinary output has no links to invalidate. Keeping an empty entry
            // for every row made each subsequent frame scan the entire scrollback.
            if !ids.isEmpty { occurrences[start] = Occurrence(end: assembly.end, ids: ids) }
        }
        let activeIDs = archivedIDs.union(occurrences.values.flatMap(\.ids))
        let previousCount = resources.count
        resources.removeAll { !activeIDs.contains($0.id) }
        if resources.count != previousCount { changed = true }
        return changed
    }

    /// The text of the row at `start` with every row it continues into, or nil while one
    /// of them has not arrived yet.
    private static func assembly(from start: Int, lines: [Int: TerminalLine], columns: Int) -> Assembly? {
        guard let first = lines[start] else { return nil }
        var text = first.text
        var hardBreaks: [Int] = []
        var line = first
        var end = start
        while mayContinue(text, row: line, columns: columns) {
            guard let next = lines[end + 1] else { return nil }
            guard continues(previous: line, next: next, columns: columns) else { break }
            // A soft-wrapped row carries its text and nothing else. A hanging one carries
            // the indent the TUI gave it, which is layout rather than content.
            if line.wrappedToNext && next.wrappedFromPrevious {
                text += next.text
            } else {
                hardBreaks.append(text.utf16.count)
                text += withoutHangingIndent(next.text)
            }
            line = next
            end += 1
        }
        return Assembly(
            text: text,
            end: end,
            hardBreaks: hardBreaks,
            uncertainEnd: !line.wrappedToNext && fillsGrid(line.text, columns: columns) && endsInsideURL(text)
        )
    }

    /// Whether the row can have a successor on the row below it. The terminal's own
    /// answer is the flag; the TUI's is a row that ends in the middle of a URL and was
    /// filled to the last column doing it.
    private static func mayContinue(_ text: String, row: TerminalLine, columns: Int) -> Bool {
        if row.wrappedToNext { return true }
        return fillsGrid(row.text, columns: columns) && endsInsideURL(text)
    }

    /// Whether `next` is the row `previous` continues into.
    private static func continues(previous: TerminalLine, next: TerminalLine, columns: Int) -> Bool {
        if previous.wrappedToNext && next.wrappedFromPrevious { return true }
        guard fillsGrid(previous.text, columns: columns), holdsURLTail(previous.text) else { return false }
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
        guard let match = detector.matches(in: text, range: range).last,
              let matched = Range(match.range, in: text) else { return false }
        return matched.upperBound == text.endIndex && isWebURL(match.url)
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
        return urlBody.contains(scalar) || CharacterSet.letters.contains(scalar)
    }

    private static func withoutHangingIndent(_ text: String) -> String {
        String(text.drop { $0 == " " || $0 == "\t" })
    }

    private static func resources(in assembly: Assembly) -> [TerminalResource] {
        let text = assembly.text
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return detector.matches(in: text, range: range).compactMap { match in
            guard let matchRange = Range(match.range, in: text) else { return nil }
            guard let url = webURL(String(text[matchRange])) else { return nil }
            var alternatives: [URL] = []
            var needsConfirmation = assembly.uncertainEnd && NSMaxRange(match.range) == text.utf16.count
            for boundary in assembly.hardBreaks
            where boundary > match.range.location && boundary < NSMaxRange(match.range) {
                needsConfirmation = true
                let prefix = NSRange(location: match.range.location, length: boundary - match.range.location)
                guard let prefixRange = Range(prefix, in: text),
                      let prefixURL = webURL(String(text[prefixRange])),
                      prefixURL != url,
                      !alternatives.contains(prefixURL) else { continue }
                alternatives.append(prefixURL)
            }
            if alternatives.contains(where: { isIncompleteSharePrefix($0, of: url) }) {
                alternatives = []
            }
            return TerminalResource(url: url, alternatives: alternatives, needsConfirmation: needsConfirmation)
        }
    }

    /// Share ids are issued at one fixed length, the `shr_` prefix included. A link whose
    /// id is shorter than that was cut on its way to the phone — it is not a second link,
    /// and asking the server about it can only ever say 404.
    static let shareIDLength = 36

    /// Share IDs issued by both the old and current server are 32 characters. A shorter
    /// prefix of the same ID is a broken wrap, not a second link to offer or confirm.
    private static func isIncompleteSharePrefix(_ shorter: URL, of complete: URL) -> Bool {
        guard let shortID = shareRootID(shorter), let completeID = shareRootID(complete),
              completeID.count == shareIDLength, shortID.count < completeID.count else { return false }
        return completeID.hasPrefix(shortID)
    }

    static func shareRootID(_ url: URL) -> String? {
        guard SynapseWebLink.isTrusted(url), url.query == nil, url.fragment == nil else { return nil }
        let originPath = AppConfiguration.apiOrigin.path
        let path = originPath.isEmpty || originPath == "/"
            ? url.path : String(url.path.dropFirst(originPath.count))
        let parts = path.split(separator: "/")
        guard parts.count == 2, parts[0] == "share", parts[1].hasPrefix("shr_") else { return nil }
        let id = String(parts[1])
        guard id.dropFirst(4).allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) else { return nil }
        return id
    }

    private static func webURL(_ candidate: String) -> URL? {
        guard let url = URL(string: withoutUnmatchedClosingDelimiters(candidate)),
              isWebURL(url),
              let host = url.host, !host.isEmpty,
              !isLocalOnly(host) else { return nil }
        return url
    }

    /// A URL may end in a balanced `)`, as in Wikipedia paths. Only a closing
    /// bracket belonging to surrounding prose is removed.
    private static func withoutUnmatchedClosingDelimiters(_ text: String) -> String {
        var candidate = text
        while let closing = candidate.last,
              let opening = closingDelimiters[closing],
              candidate.filter({ $0 == closing }).count > candidate.filter({ $0 == opening }).count {
            candidate.removeLast()
        }
        return candidate
    }

    private static func isWebURL(_ url: URL?) -> Bool {
        guard let scheme = url?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    /// Whether the host points at the machine that printed it rather than at anything a
    /// phone could reach.
    private static func isLocalOnly(_ host: String) -> Bool {
        var name = host.lowercased()
        // `::` is the unspecified address, and `[::ffff:127.0.0.1]` is `127.0.0.1` in
        // another spelling — Foundation hands the second one back in the longer form.
        // `::1` is loopback and is left for the check below.
        if name == "::" { return true }
        if name.hasPrefix("::ffff:") { name = String(name.dropFirst("::ffff:".count)) }
        if name == "localhost" || name.hasSuffix(".localhost") { return true }
        if name == "::1" { return true }
        // The whole of 127.0.0.0/8 is loopback, not just the one address people type.
        let parts = name.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count == 4, parts[0] == "127" { return true }
        // 0.0.0.0 is a listen-on-everything address: a server that prints it is saying
        // where it bound, not where it can be opened from.
        return name == "0.0.0.0"
    }
}
