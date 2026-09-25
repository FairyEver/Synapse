import Foundation

/// 主页栈里的落点。
///
/// 只有两个 ——「新建会话」不在这里：它是一张 sheet，而 sheet 不是栈上的一层。
/// 把它做成页面意味着拆掉 `NewSessionSheet` 内部那套项目 / 供应商 / 模型的三层下钻
/// 再照着主页的栈重搭一遍，买不到任何东西。
enum HomeRoute: Hashable {
    case recordings
    case clipboard
}
