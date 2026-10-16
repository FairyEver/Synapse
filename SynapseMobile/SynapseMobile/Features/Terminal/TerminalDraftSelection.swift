import SwiftUI

enum TerminalDraftSelection {
    static func binding(
        selection: Binding<TextSelection?>,
        text: Binding<String>,
        insertion: Binding<TerminalDraftInsertion>
    ) -> Binding<TextSelection?> {
        Binding(get: { selection.wrappedValue }, set: { value in
            // IME selection can arrive before its text. Always acknowledge it so
            // a render cannot push the previous cursor back into either editor.
            selection.wrappedValue = value
            // Focus loss clears the binding, not the last valid reference position.
            guard let value else { return }
            if case .selection(let range) = value.indices,
               let offsets = TerminalDraftInsertion.utf16Selection(range, in: text.wrappedValue) {
                insertion.wrappedValue.update(text: text.wrappedValue, selection: offsets)
            }
        })
    }
}
