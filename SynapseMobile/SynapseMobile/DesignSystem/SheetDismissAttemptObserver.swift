import SwiftUI
import UIKit

/// Preserve SwiftUI's presentation delegate while observing an attempted swipe.
struct SheetDismissAttemptObserver: UIViewControllerRepresentable {
    let blocked: Bool
    let onAttempt: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) {
        let coordinator = context.coordinator
        coordinator.blocked = blocked
        coordinator.onAttempt = onAttempt
        controller.onAttach = { [weak controller, weak coordinator] in
            guard let controller, let coordinator else { return }
            var ancestor = controller.parent
            while let candidate = ancestor {
                if candidate.presentingViewController != nil, let presentation = candidate.presentationController {
                    if presentation.delegate !== coordinator {
                        coordinator.original = presentation.delegate
                        presentation.delegate = coordinator
                    }
                    return
                }
                ancestor = candidate.parent
            }
        }
        DispatchQueue.main.async { [weak controller] in controller?.onAttach?() }
    }

    final class Controller: UIViewController {
        var onAttach: (() -> Void)?
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            onAttach?()
        }
    }

    final class Coordinator: NSObject, UIAdaptivePresentationControllerDelegate {
        var blocked = false
        var onAttempt: (() -> Void)?
        weak var original: (any UIAdaptivePresentationControllerDelegate)?

        func presentationControllerShouldDismiss(_ presentationController: UIPresentationController) -> Bool {
            !blocked && (original?.presentationControllerShouldDismiss?(presentationController) ?? true)
        }
        func presentationControllerDidAttemptToDismiss(_ presentationController: UIPresentationController) {
            if blocked { onAttempt?() }
            else { original?.presentationControllerDidAttemptToDismiss?(presentationController) }
        }
        func presentationControllerWillDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerWillDismiss?(presentationController)
        }
        func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
            original?.presentationControllerDidDismiss?(presentationController)
        }
    }
}

