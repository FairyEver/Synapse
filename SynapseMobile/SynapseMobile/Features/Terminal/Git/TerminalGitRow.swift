import SwiftUI

/// 一行「可以进去」的动作，或者一行「现在点不了，原因写在右边」。
///
/// 面板、新建分支、合并三处用的都是同一种行，所以它只有一个实现：设置类应用里
/// 「标签 + 值 + 尖括号」的行长什么样，是系统说了算的，不是每一页各画一次。
///
/// 可点的行总有尖括号；`detail` 可以是当前值，也可以是停用原因。
/// 停用的行只显示原因，不显示尖括号。
struct TerminalGitActionRow: View {
    let title: String
    /// 右侧的值，或者不能点的原因。
    var detail: String? = nil
    var enabled: Bool = true
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.select()
            action()
        } label: {
            HStack(spacing: 12) {
                Text(title)
                Spacer(minLength: 8)
                if let detail {
                    Text(detail)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                if enabled {
                    Image(systemName: "chevron.forward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            // 整行都是点击目标，不只是文字那一段。
            .contentShape(Rectangle())
        }
        // 变灰由系统画，不是我们自己调透明度 —— 停用的行要和别处停用的行长得一样。
        .disabled(!enabled)
        .accessibilityIdentifier(identifier)
    }
}
