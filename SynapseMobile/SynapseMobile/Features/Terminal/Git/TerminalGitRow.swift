import SwiftUI

/// 一行「可以进去」的动作，或者一行「现在点不了，原因写在右边」。
///
/// 面板、新建分支、合并三处用的都是同一种行，所以它只有一个实现：设置类应用里
/// 「标签 + 值 + 尖括号」的行长什么样，是系统说了算的，不是每一页各画一次。
///
/// 右侧那两样是**二选一**的：有 `detail` 就没有尖括号。这不是画法上的偏好 ——
/// 「无改动」这种话是**不能点的原因**，它右侧再挂一个尖括号，就是在说「点进去
/// 有东西」，而里面什么都没有。
struct TerminalGitActionRow: View {
    let title: String
    /// 右侧的值，或者不能点的原因。为空时右侧画尖括号。
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
                } else {
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
