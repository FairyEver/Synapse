import UIKit

/// 剪贴板：把一段字交出去。
///
/// 全 App 一份。拷进剪贴板是「结果不在这块屏幕上」那一类动作的样板 —— 东西走了，屏幕上
/// 什么都不动 —— 所以这一族永远是连着三件事：放进剪贴板、嗡一声、说一句话。九处各写各的
/// 时候，三件事在每一处缺的不是同一件（有的没提示、有的没嗡、有的把嗡放在了调用点另一边），
/// 读者看到的就都是「按下去什么都没发生」。
///
/// 三件事收在一处还有个理由，见 `Haptics` 那条「一次结果只嗡一声」：成功那一声归调用点，
/// 失败那一声归 `SynapseAppModel.notice` 自己。这一族只做成功，所以嗡在这里发。
enum Clipboard {
    /// 放进剪贴板，并给一声嗡。
    ///
    /// 没有提示的那一处用这个：终端选区拷完要清掉选区，那一下本身就是回执。
    @MainActor
    static func copy(_ text: String) {
        UIPasteboard.general.string = text
        Haptics.success()
    }

    /// 放进剪贴板 + 嗡一声 + 一句提示。
    ///
    /// - Parameter id: 那句话的身份。同一个 id 连着拷两次会**重启**那一句，而不是排两句
    ///   一模一样的 —— 这一族动作常是连着按的（一行接一行地拷），id 就是为这个给的。
    ///   不给就按文案认（`SynapseAppModel.notice` 的规矩）。
    @MainActor
    static func copy(_ text: String, saying message: String, id: String? = nil, on model: SynapseAppModel) {
        copy(text)
        model.notice(message, tone: .success, id: id)
    }
}
