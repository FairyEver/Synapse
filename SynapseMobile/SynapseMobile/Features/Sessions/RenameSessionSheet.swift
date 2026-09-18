import SwiftUI

/// Renaming one terminal.
///
/// A sheet rather than an alert, for the one thing an alert cannot hold: its text field
/// belongs to the system and nothing can be placed inside it, so the ✕ that empties a
/// field everywhere else on iOS has no way in. This field is drawn here, which is what
/// lets ✕ sit in it.
///
/// The field opens on the current name. Most renames change a word or two, and the other
/// case — the whole name goes — is what ✕ is for.
struct RenameSessionSheet: View {
    /// The name the field opens on.
    let title: String
    /// The new name, once the reader saves it. Never empty and never all spaces.
    let onSave: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: String
    @FocusState private var focused: Bool

    init(title: String, onSave: @escaping (String) -> Void) {
        self.title = title
        self.onSave = onSave
        // Seeded here rather than in an `onAppear`: the name has to be in the field the
        // moment it is drawn, and an `onAppear` can land after the reader has typed.
        _draft = State(initialValue: title)
    }

    /// A name made only of spaces is not a name, and it does not look like an empty field
    /// either — so what decides whether there is something to save is the trimmed copy,
    /// while the field keeps exactly what was typed.
    private var newName: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            List {
                HStack(spacing: 8) {
                    TextField("名称", text: $draft)
                        .focused($focused)
                        // Return saves, the way it does in every other single-line field
                        // on the system. There is nothing else it could mean here.
                        .submitLabel(.done)
                        .onSubmit(save)
                        .accessibilityIdentifier("rename-field")
                    if !draft.isEmpty {
                        Button {
                            draft = ""
                            // Clearing is not leaving: the tap means "I am about to type
                            // something else", so the keyboard stays where it is.
                            focused = true
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(Color.secondary)
                        }
                        .buttonStyle(.plain)
                        // Named for what it does, not for what it looks like: this is what
                        // VoiceOver reads out, and the glyph alone says nothing.
                        .accessibilityLabel("清空")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("重命名终端")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    // Grey until there is a name to save. The computer drops an empty
                    // rename silently, so a live button here would be a key that does
                    // nothing — and the reader has just emptied the field, so this is the
                    // state they see it in.
                    Button("保存", action: save)
                        .disabled(newName.isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .onAppear { focused = true }
    }

    private func save() {
        guard !newName.isEmpty else { return }
        dismiss()
        onSave(newName)
    }
}
