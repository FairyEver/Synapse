import Testing
@testable import SynapseMobile

/// 一行权限状态在三种状态下分别该做什么。
///
/// 这条判据值得单测，因为它的错误形态是「按下去没反应」—— iOS 在应用问过一次之后
/// 不再弹框，一次被拒之后用户只能自己去系统设置里改。所以「被拒」这一档必须变成一扇
/// 通往系统设置的门，而不是一个沉默的按钮。
struct PermissionRowTests {

    @Test func grantedHasNothingToDo() {
        #expect(PermissionRow.action(for: .granted) == .none)
    }

    /// 没问过就问一次，系统会弹框。
    @Test func undeterminedAsksTheSystem() {
        #expect(PermissionRow.action(for: .undetermined) == .request)
    }

    /// 被拒之后系统不再弹框了，只能去系统设置里开。
    @Test func deniedOpensSystemSettings() {
        #expect(PermissionRow.action(for: .denied) == .openSettings)
    }

    /// 三种状态各有各的字，没有一种是空白。
    @Test func everyStateHasALabel() {
        #expect(PermissionRow.State.granted.label == "已允许")
        #expect(PermissionRow.State.denied.label == "已拒绝")
        #expect(PermissionRow.State.undetermined.label == "未请求")
    }
}
