import Foundation

/// 主页栈里的落点。
///
/// 只有三个 ——「新建会话」不在这里：它是一张 sheet，而 sheet 不是栈上的一层。
/// 把它做成页面意味着拆掉 `NewSessionSheet` 内部那套项目 / 供应商 / 模型的三层下钻
/// 再照着主页的栈重搭一遍，买不到任何东西。
///
/// 这个枚举里有两种东西，**用法不同**（见 `RootView.homeTab`）：
///
/// - `.clipboard` 是栈上真的一层，推进去只有一条导航栏。
/// - `.recordings` 与 `.drive` 是「换掉这一格内容」的功能页，不是栈上的一层。它们各自
///   带 `NavigationSplitView`（分栏自带一条导航栏），推进栈里屏幕上会出现两条栏。
///   它们出现在这一条 path 上只是**指认现在这一格归谁**：`homePath = [.drive]`。
enum HomeRoute: Hashable {
    case recordings
    case drive
    case clipboard
}
