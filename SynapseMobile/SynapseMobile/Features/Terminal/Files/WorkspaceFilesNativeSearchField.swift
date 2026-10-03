import SwiftUI
import UIKit

/// The file browser uses the native input's measured bounds.
/// The surrounding search row owns its glyph, clear button and submit button.
struct WorkspaceFilesNativeSearchField: UIViewRepresentable {
    @Binding var text: String
    @Binding var isPresented: Bool
    let submit: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.placeholder = "搜索文件"
        field.borderStyle = .roundedRect
        field.textColor = .label
        field.adjustsFontForContentSizeCategory = true
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.returnKeyType = .search
        field.clearButtonMode = .never
        field.accessibilityLabel = "搜索文件"
        field.accessibilityIdentifier = "files-search"
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.editingChanged(_:)), for: .editingChanged)
        updateControlEnvironment(field, context: context)
        updateFont(field, dynamicTypeSize: context.environment.dynamicTypeSize)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self
        updateControlEnvironment(field, context: context)
        updateFont(field, dynamicTypeSize: context.environment.dynamicTypeSize)
        // Reassigning an unchanged string resets native selection. Never replace
        // provisional IME text while the user is choosing its confirmed form.
        if field.text != text, field.markedTextRange == nil {
            field.text = text
            field.invalidateIntrinsicContentSize()
        }
        if !isPresented, field.isFirstResponder {
            field.resignFirstResponder()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextField, context: Context) -> CGSize? {
        // A size pass can precede updateUIView when Dynamic Type changes.
        updateFont(uiView, dynamicTypeSize: context.environment.dynamicTypeSize)
        let proposedWidth = proposal.width ?? uiView.intrinsicContentSize.width
        guard proposedWidth.isFinite, proposedWidth > 0 else { return nil }
        let natural = uiView.sizeThatFits(CGSize(width: proposedWidth, height: .greatestFiniteMagnitude))
        let lineHeight = uiView.font?.lineHeight ?? natural.height
        let contentHeight = max(natural.height, max(uiView.intrinsicContentSize.height, lineHeight))
        return CGSize(width: proposedWidth, height: max(Metrics.minimumTapTarget, ceil(contentHeight)))
    }

    static func dismantleUIView(_ uiView: UITextField, coordinator: Coordinator) {
        uiView.delegate = nil
        uiView.removeTarget(coordinator, action: #selector(Coordinator.editingChanged(_:)), for: .editingChanged)
        uiView.resignFirstResponder()
    }

    private func updateControlEnvironment(_ field: UITextField, context: Context) {
        field.isEnabled = context.environment.isEnabled
        field.semanticContentAttribute = context.environment.layoutDirection == .rightToLeft
            ? .forceRightToLeft : .forceLeftToRight
    }

    private func updateFont(_ field: UITextField, dynamicTypeSize: DynamicTypeSize) {
        let traits = field.traitCollection.modifyingTraits {
            $0.preferredContentSizeCategory = UIContentSizeCategory(dynamicTypeSize)
        }
        let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: traits)
        if field.font != font {
            field.font = font
            field.invalidateIntrinsicContentSize()
            field.setNeedsLayout()
        }
    }

    @MainActor final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: WorkspaceFilesNativeSearchField

        init(parent: WorkspaceFilesNativeSearchField) {
            self.parent = parent
        }

        @objc func editingChanged(_ field: UITextField) {
            let value = field.text ?? ""
            if parent.text != value { parent.text = value }
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            if !parent.isPresented { parent.isPresented = true }
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            if parent.isPresented { parent.isPresented = false }
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            // Let the input method confirm provisional text before submitting.
            guard textField.markedTextRange == nil else { return true }
            let value = textField.text ?? ""
            let submit = parent.submit
            if parent.text != value { parent.text = value }
            textField.resignFirstResponder()
            if parent.isPresented { parent.isPresented = false }
            submit(value)
            return false
        }
    }
}
