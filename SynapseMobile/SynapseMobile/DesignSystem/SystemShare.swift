import SwiftUI
import UIKit

/// 系统那一张分享表：存储到文件、拷贝、发微信……都在它里面。
///
/// 全 App 一份。交出去的东西各处不同 —— 云盘导出是一批文件、诊断日志是一个压缩包、站内
/// 网页是一条链接、终端选区是一段文本 —— 但面板是同一个。从前四处各写一份，四份里凑不齐
/// 一套完整的东西：iPad 的锚点、弹出来时挂在哪一层、收尾那一下，各自只写对了一半，改一处
/// 忘一处是迟早的事。
///
/// **SwiftUI 里走 `.sheet`，不要用 `present`。** 从 responder chain 上找那个最上层的
/// 控制器，弹出层级一变随时可能找错人；`.sheet` 是系统自己给的挂法，挂在哪就在哪出现。
/// `present` 只给 UIKit 那边发起的分享用（终端选区的编辑菜单就在那一层，SwiftUI 的
/// `.sheet` 够不到它）。
struct SystemShareSheet: UIViewControllerRepresentable {
    /// 交给系统的东西：文件 URL、网页链接、一段文本都行 —— `UIActivityViewController`
    /// 收 `[Any]`，面板自己按类型决定能干什么。
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        anchorToItself(controller)
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

extension SystemShareSheet {
    /// 从最上层的控制器直接弹出来。
    ///
    /// - Parameter anchor: iPad 上箭头指的地方 —— 终端给的是选区那一格。
    @MainActor
    static func present(items: [Any], from view: UIView, anchor: CGRect) {
        guard let presenter = topmost(from: view) else { return }
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // iPad 上它长成一个 popover，必须有个指的地方；没有锚点 UIKit 直接抛异常。
        controller.popoverPresentationController?.sourceView = view
        controller.popoverPresentationController?.sourceRect = anchor
        // 下一轮 runloop 再弹：编辑菜单这时还在收，正收着的时候要一张面板，就是它永远不
        // 出来的那种写法。
        DispatchQueue.main.async { presenter.present(controller, animated: true) }
    }

    /// 最近的控制器，连同它上面盖着的那些。
    ///
    /// 面板要由最前面那个控制器 present，不能由一张已经盖着别的层的屏幕来。
    private static func topmost(from view: UIView) -> UIViewController? {
        var responder: UIResponder? = view
        while let current = responder, !(current is UIViewController) {
            responder = current.next
        }
        var top = (responder as? UIViewController) ?? view.window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

/// iPad 上它会以 popover 出现，没有锚点 UIKit 会直接抛异常。`sourceView` 就在自己身上，
/// 取中间那一点；箭头收起来，因为这时的形状是「整幅面板」，不是从某处冒出来的一小块。
private func anchorToItself(_ controller: UIActivityViewController) {
    guard let popover = controller.popoverPresentationController else { return }
    popover.sourceView = controller.view
    popover.sourceRect = CGRect(
        x: controller.view.bounds.midX,
        y: controller.view.bounds.midY,
        width: 0,
        height: 0
    )
    popover.permittedArrowDirections = []
}
