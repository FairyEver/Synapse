import XCTest
@testable import SynapseMobile

final class TerminalDraftInsertionTests: XCTestCase {
    func testSelectionEndPreservesSelectedTextAndSeparatesBothSides() {
        var draft = TerminalDraftInsertion()
        draft.update(text: "abcd", selection: NSRange(location: 1, length: 2))
        let result = draft.insert("'/tmp/a b'", matching: draft.ticket())
        XCTAssertEqual(result?.text, "abc '/tmp/a b' d")
        XCTAssertEqual(result?.selection, NSRange(location: 15, length: 0))
        draft.update(text: "前段😀中段后段", selection: NSRange(location: 4, length: 2))
        XCTAssertEqual(draft.insert("ref", matching: draft.ticket())?.text, "前段😀中段 ref 后段")
    }

    func testWhitespaceIsNotDuplicatedAndMissingSelectionUsesEnd() {
        var draft = TerminalDraftInsertion()
        draft.update(text: "中文\n", selection: nil)
        XCTAssertEqual(draft.insert("/tmp/file", matching: draft.ticket())?.text, "中文\n/tmp/file")
        draft.update(text: "a\t b", selection: NSRange(location: 2, length: 0))
        XCTAssertEqual(draft.insert("ref", matching: draft.ticket())?.text, "a\tref b")
    }

    func testEmojiAndCombiningCharacterCannotBeSplit() {
        for text in ["😀x", "e\u{301}x", "👨‍👩‍👧‍👦x"] {
            var draft = TerminalDraftInsertion()
            draft.update(text: text, selection: NSRange(location: 1, length: 0))
            XCTAssertNil(draft.selection)
            XCTAssertEqual(draft.insert("ref", matching: draft.ticket())?.text, text + " ref")
        }
    }

    func testEditingTextOrSelectionRejectsDelayedReference() {
        var draft = TerminalDraftInsertion()
        draft.update(text: "a", selection: NSRange(location: 1, length: 0))
        let ticket = draft.ticket()
        draft.update(text: "a", selection: NSRange(location: 0, length: 0))
        XCTAssertNil(draft.insert("ref", matching: ticket))
        draft.update(text: "new", selection: nil)
        XCTAssertNil(draft.insert("ref", matching: ticket))
        XCTAssertEqual(draft.text, "new")
    }

    func testTransientSelectionFromOtherTextNeverConvertsForeignIndex() {
        let old = "较长的中文😀"
        XCTAssertNil(TerminalDraftInsertion.utf16Selection(old.endIndex..<old.endIndex, in: "保"))
        let text = "a😀中文"
        let lower = text.index(after: text.startIndex)
        XCTAssertEqual(TerminalDraftInsertion.utf16Selection(lower..<text.endIndex, in: text), NSRange(location: 1, length: 4))
    }

    func testEmptyDraftAndControlCharacterRejection() {
        var draft = TerminalDraftInsertion()
        XCTAssertEqual(draft.insert("ref", matching: draft.ticket())?.text, "ref")
        XCTAssertNil(draft.insert("bad\nref", matching: draft.ticket()))
    }
}
