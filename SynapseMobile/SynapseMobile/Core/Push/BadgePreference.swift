import Foundation

/// 「图标角标」这一个开关。
///
/// 键放在这里而不是在两处各写一遍：读它的一处是设置页里那一行，另一处是根视图里真正去写
/// 角标的地方 —— 一个字符串写两遍，改的时候就会分叉。
enum BadgePreference {
    static let key = "SynapseIconBadge"
}
