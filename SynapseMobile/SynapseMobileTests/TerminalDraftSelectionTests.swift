import SwiftUI
import XCTest
@testable import SynapseMobile

final class TerminalDraftSelectionTests: XCTestCase {
    func testSelectionBeforeChineseTextKeepsTypingOrder() throws {
        let state = DraftState()
        state.selection = TextSelection(insertionPoint: state.text.startIndex)

        for word in ["你", "好", "世界"] {
            let selection = try XCTUnwrap(state.binding.wrappedValue)
            guard case .selection(let range) = selection.indices else {
                return XCTFail("Expected a single insertion point")
            }
            let offsets = try XCTUnwrap(TerminalDraftInsertion.utf16Selection(range, in: state.text))
            var nextText = state.text
            let position = String.Index(utf16Offset: offsets.location, in: nextText)
            nextText.insert(contentsOf: word, at: position)
            let nextPosition = String.Index(utf16Offset: offsets.location + word.utf16.count, in: nextText)

            // IMEs can report the new cursor before SwiftUI publishes the new text.
            state.binding.wrappedValue = TextSelection(insertionPoint: nextPosition)
            state.text = nextText
        }

        XCTAssertEqual(state.text, "你好世界")
        XCTAssertEqual(state.selection, TextSelection(insertionPoint: state.text.endIndex))
    }

    func testTextBeforeSelectionTracksReferenceInsertion() throws {
        let state = DraftState()
        state.text = "前😀后"
        let cursor = state.text.index(before: state.text.endIndex)
        state.binding.wrappedValue = TextSelection(insertionPoint: cursor)

        XCTAssertEqual(state.selection, TextSelection(insertionPoint: cursor))
        let result = try XCTUnwrap(state.insertion.insert("ref", matching: state.insertion.ticket()))
        XCTAssertEqual(result.text, "前😀 ref 后")
    }

    func testCompositionSelectionDoesNotRestorePreviousCursor() {
        let state = DraftState()
        state.text = "ni"
        state.binding.wrappedValue = TextSelection(insertionPoint: state.text.startIndex)
        let committed = "你"
        let selection = TextSelection(insertionPoint: committed.endIndex)

        state.binding.wrappedValue = selection

        XCTAssertEqual(state.selection, selection)
        // A selection from the pending Chinese text must not be used to index "ni".
        XCTAssertEqual(state.insertion.selection, NSRange(location: 0, length: 0))
    }

    func testFocusLossKeepsLastValidReferencePosition() throws {
        let state = DraftState()
        state.text = "前后"
        state.binding.wrappedValue = TextSelection(insertionPoint: state.text.index(after: state.text.startIndex))
        let ticket = state.insertion.ticket()

        state.binding.wrappedValue = nil

        XCTAssertNil(state.selection)
        XCTAssertEqual(state.insertion.insert("ref", matching: ticket)?.text, "前 ref 后")
    }

    private final class DraftState {
        var text = ""
        var selection: TextSelection?
        var insertion = TerminalDraftInsertion()

        var binding: Binding<TextSelection?> {
            TerminalDraftSelection.binding(
                selection: Binding(get: { self.selection }, set: { self.selection = $0 }),
                text: Binding(get: { self.text }, set: { self.text = $0 }),
                insertion: Binding(get: { self.insertion }, set: { self.insertion = $0 })
            )
        }
    }
}
