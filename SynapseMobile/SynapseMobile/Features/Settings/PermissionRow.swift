import SwiftUI
import UIKit

/// 一行权限状态：右侧是状态文字，点按按状态决定做什么。
///
/// 两个分类共用一行 ——「录音」的麦克风与「通知」的系统通知 —— 因为它们的形态是同一个。
/// iOS 不给应用「再问一次」的机会：问过一次之后系统不再弹框，用户只能自己去系统设置里改。
/// 所以被拒之后这一行必须变成一扇通往系统设置的门，而不是一个按下去没反应的按钮。
struct PermissionRow: View {
    enum State: Equatable {
        case granted
        case denied
        case undetermined

        var label: String {
            switch self {
            case .granted: "已允许"
            case .denied: "已拒绝"
            case .undetermined: "未请求"
            }
        }
    }

    enum Action: Equatable {
        case request
        case openSettings
        case none
    }

    /// 三种状态各自该做什么。纯函数，好判。
    static func action(for state: State) -> Action {
        switch state {
        case .granted: .none
        case .denied: .openSettings
        case .undetermined: .request
        }
    }

    let title: String
    let state: State
    /// 状态是「未请求」时按下去要做的事：触发系统弹框。
    let onRequest: () async -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            switch Self.action(for: state) {
            case .none:
                break
            case .request:
                Task { await onRequest() }
            case .openSettings:
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                openURL(url)
            }
        } label: {
            HStack {
                Text(title)
                Spacer(minLength: 8)
                Text(state.label)
                    .foregroundStyle(.secondary)
                // 只在真有下一步的时候画箭头：一个点不动的行带箭头是在骗人。
                if Self.action(for: state) != .none {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(Self.action(for: state) == .none)
        .accessibilityIdentifier("permission-\(title)")
    }
}
