import SwiftUI

/// 一台电脑的名字，以及它现在够不够得着。
///
/// 终端页的设备行和主页的顶栏问的是同一件事 ——「我现在在哪一台电脑上」—— 所以这套词汇
/// 只有这一份。下面三条判据都是它存在的理由，复制出第二份就一定会分叉：
///
/// - 圆点**只在真的够得着**时才是绿的。一个因为没取到列表而空着的结果，不是一台在线的
///   电脑，圆点不能替它那么说。
/// - 名字由调用方从 `desktopName(_:)` 取，而不是从 `summary` 一家取：一台已经走掉的电脑
///   不再发送载着它名字的那份列表，而那正是读者最需要知道它是哪一台的时候。
/// - 上下箭头**只在真别处可去**时才出现。它不是装饰，是一个承诺。
///
/// 它只画，不管点击：包住它的那一层决定点下去去哪 —— 终端页是设备行里的 `Menu`，主页是
/// 顶栏上的同一个 `Menu`。
struct DesktopIdentityLabel: View {
    /// 已经从 `desktopName(_:)` 拿到的名字。`nil` 表示这台手机还没落在任何电脑上。
    let name: String?
    /// 真的够得着。只有它为真，圆点才是绿的。
    let isOnline: Bool
    /// 别处有得可去。它决定箭头出不出现。
    let showsSwitchAffordance: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(isOnline ? Theme.running : Color.secondary)
                .frame(width: 7, height: 7)
            Text(name ?? "未连接电脑")
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
            if showsSwitchAffordance {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }
}
