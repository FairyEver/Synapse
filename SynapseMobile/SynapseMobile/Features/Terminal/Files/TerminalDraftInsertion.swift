import Foundation

/// A reference result may only mutate the exact draft and selection that requested it.
struct TerminalDraftInsertion: Equatable {
    struct Ticket: Equatable {
        let generation: UInt64
        let text: String
        let selection: NSRange?
    }

    private(set) var generation: UInt64 = 0
    private(set) var text = ""
    private(set) var selection: NSRange?

    mutating func update(text: String, selection: NSRange?) {
        let valid = Self.validSelection(selection, in: text)
        guard self.text != text || self.selection != valid else { return }
        self.text = text
        self.selection = valid
        generation &+= 1
    }

    func ticket() -> Ticket { Ticket(generation: generation, text: text, selection: selection) }

    mutating func insert(_ reference: String, matching ticket: Ticket) -> (text: String, selection: NSRange)? {
        guard ticket == self.ticket(), !reference.isEmpty,
              !reference.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        let offset = ticket.selection.map { $0.location + $0.length } ?? text.utf16.count
        guard let position = Self.characterIndex(offset, in: text) else { return nil }
        let prefix = text[..<position]
        let suffix = text[position...]
        let left = prefix.last.map { !$0.isWhitespace } == true ? " " : ""
        let right = suffix.first.map { !$0.isWhitespace } == true ? " " : ""
        let inserted = left + reference + right
        let nextText = String(prefix) + inserted + String(suffix)
        let nextSelection = NSRange(location: offset + inserted.utf16.count, length: 0)
        update(text: nextText, selection: nextSelection)
        return (nextText, nextSelection)
    }

    /// SwiftUI can deliver a selection before its text binding changes. Walk only
    /// indexes belonging to the current string; converting a stale index directly
    /// with NSRange(_:in:) can trap for Chinese, emoji, or a shortened draft.
    static func utf16Selection(_ range: Range<String.Index>, in text: String) -> NSRange? {
        var lower: Int?
        var upper: Int?
        var offset = 0
        for index in text.indices {
            if index == range.lowerBound { lower = offset }
            if index == range.upperBound { upper = offset }
            offset += text[index].utf16.count
        }
        if range.lowerBound == text.endIndex { lower = offset }
        if range.upperBound == text.endIndex { upper = offset }
        guard let lower, let upper, lower <= upper else { return nil }
        return NSRange(location: lower, length: upper - lower)
    }

    static func validSelection(_ range: NSRange?, in text: String) -> NSRange? {
        guard let range, range.location != NSNotFound, range.location >= 0, range.length >= 0,
              range.location <= text.utf16.count, range.length <= text.utf16.count - range.location,
              characterIndex(range.location, in: text) != nil,
              characterIndex(range.location + range.length, in: text) != nil else { return nil }
        return range
    }

    private static func characterIndex(_ offset: Int, in text: String) -> String.Index? {
        guard offset >= 0, offset <= text.utf16.count else { return nil }
        let candidate = String.Index(utf16Offset: offset, in: text)
        guard candidate == text.endIndex || text.indices.contains(candidate) else { return nil }
        return candidate
    }
}
