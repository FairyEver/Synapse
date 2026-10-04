import SwiftUI
import UIKit

/// The file browser uses the native input's measured bounds.
/// The system search field owns its glyph and appearance, with a native 44pt clear action.
struct WorkspaceFilesNativeSearchField: UIViewRepresentable {
    @Binding var text: String
    @Binding var isPresented: Bool
    @Binding var isComposing: Bool
    let submit: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UISearchTextField {
        let field = UISearchTextField()
        field.backgroundColor = .tertiarySystemFill
        field.placeholder = "搜索文件"
        field.textColor = .label
        field.adjustsFontForContentSizeCategory = true
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.returnKeyType = .search
        // A real accessory button preserves the standard search appearance
        // while exposing the same 44pt bounds to touch and VoiceOver.
        field.clearButtonMode = .never
        let clear = UIButton(type: .system)
        clear.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        clear.tintColor = .secondaryLabel
        clear.accessibilityLabel = "清除搜索"
        clear.accessibilityIdentifier = "files-search-clear"
        clear.frame.size = CGSize(width: Metrics.minimumTapTarget, height: Metrics.minimumTapTarget)
        clear.addTarget(context.coordinator, action: #selector(Coordinator.clearSearch), for: .touchUpInside)
        field.rightView = clear
        field.rightViewMode = text.isEmpty ? .never : .always
        context.coordinator.field = field
        field.accessibilityLabel = "搜索文件"
        field.accessibilityIdentifier = "files-search"
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.editingChanged(_:)), for: .editingChanged)
        updateControlEnvironment(field, context: context)
        updateFont(field, dynamicTypeSize: context.environment.dynamicTypeSize)
        return field
    }

    func updateUIView(_ field: UISearchTextField, context: Context) {
        context.coordinator.parent = self
        updateControlEnvironment(field, context: context)
        updateFont(field, dynamicTypeSize: context.environment.dynamicTypeSize)
        // Reassigning an unchanged string resets native selection. Never replace
        // provisional IME text while the user is choosing its confirmed form.
        if field.text != text, field.markedTextRange == nil {
            field.text = text
            field.invalidateIntrinsicContentSize()
        }
        field.rightViewMode = text.isEmpty ? .never : .always
        if !isPresented, field.isFirstResponder {
            field.resignFirstResponder()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UISearchTextField, context: Context) -> CGSize? {
        // A size pass can precede updateUIView when Dynamic Type changes.
        updateControlEnvironment(uiView, context: context)
        updateFont(uiView, dynamicTypeSize: context.environment.dynamicTypeSize)
        let proposedWidth = proposal.width ?? uiView.intrinsicContentSize.width
        guard proposedWidth.isFinite, proposedWidth > 0 else { return nil }
        let natural = uiView.sizeThatFits(CGSize(width: proposedWidth, height: .greatestFiniteMagnitude))
        let lineHeight = uiView.font?.lineHeight ?? natural.height
        let contentHeight = max(natural.height, max(uiView.intrinsicContentSize.height, lineHeight))
        return CGSize(width: proposedWidth, height: max(Metrics.minimumTapTarget, ceil(contentHeight)))
    }

    static func dismantleUIView(_ uiView: UISearchTextField, coordinator: Coordinator) {
        uiView.delegate = nil
        (uiView.rightView as? UIButton)?.removeTarget(coordinator, action: #selector(Coordinator.clearSearch), for: .touchUpInside)
        uiView.rightView = nil
        coordinator.field = nil
        uiView.removeTarget(coordinator, action: #selector(Coordinator.editingChanged(_:)), for: .editingChanged)
        uiView.resignFirstResponder()
    }

    private func updateControlEnvironment(_ field: UISearchTextField, context: Context) {
        field.overrideUserInterfaceStyle = context.environment.colorScheme == .dark ? .dark : .light
        field.traitOverrides.preferredContentSizeCategory = UIContentSizeCategory(context.environment.dynamicTypeSize)
        field.isEnabled = context.environment.isEnabled
        field.rightView?.isUserInteractionEnabled = context.environment.isEnabled
        field.semanticContentAttribute = context.environment.layoutDirection == .rightToLeft
            ? .forceRightToLeft : .forceLeftToRight
    }

    private func updateFont(_ field: UISearchTextField, dynamicTypeSize: DynamicTypeSize) {
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
        weak var field: UISearchTextField?

        init(parent: WorkspaceFilesNativeSearchField) {
            self.parent = parent
        }

        @objc func clearSearch() {
            guard let field, field.isEnabled else { return }
            field.text = ""
            field.rightViewMode = .never
            parent.text = ""
            updateCompositionState(field)
        }

        @objc func editingChanged(_ field: UITextField) {
            updateCompositionState(field)
            let value = field.text ?? ""
            if parent.text != value { parent.text = value }
        }

        func textFieldDidChangeSelection(_ textField: UITextField) {
            updateCompositionState(textField)
        }

        private func updateCompositionState(_ field: UITextField) {
            let composing = field.markedTextRange != nil
            if parent.isComposing != composing { parent.isComposing = composing }
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            if !parent.isPresented { parent.isPresented = true }
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            if parent.isComposing { parent.isComposing = false }
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
