import SwiftUI

/// 会话创建 sheet 的装配，两处共用。
///
/// 它在两个地方被打开：终端列表右上角的 ＋，和主页功能里的「新建会话」。两处必须打开
/// 同一个界面、接同样的三个回调，**包括那个容易漏的 `setMode(.phoneDriven)`** —— 手机
/// 让电脑建出来的终端，尺寸归手机；漏掉这一步的表现是「手机上建的终端按电脑的列宽显示」，
/// 而那是一条只有真拿两台设备对着看才发现得了的差别。
///
/// 做成修饰符而不是一个包一层 `Color.clear` 的容器视图：调用方本来就是「列表 + 一个 sheet」，
/// 修饰符长在这个列表上，没有多出来的一层。
private struct NewSessionSheetModifier: ViewModifier {
    @Environment(SynapseAppModel.self) private var model
    @Environment(TerminalDisplaySettings.self) private var display
    @Binding var isPresented: Bool
    let onOpenCreated: (String) -> Void

    /// 打开一个手机刚刚让电脑建出来的终端。
    ///
    /// 与「用户挑了哪一行」是两件事：那个 id 是电脑亲口回给我们的，它一定存在，
    /// 不必过 `RootView` 那道「还开不开得开」的闸门（拿那道闸门去问，用户按下
    /// 「开始对话」得到的第一句话会是「这个会话已经结束了」—— 列表还没跟上的那一下）。
    private func openNewlyCreated(_ sessionId: String) {
        display.setMode(.phoneDriven, for: sessionId)
        onOpenCreated(sessionId)
    }

    func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented) {
            NewSessionSheet(
                onCreated: { groupId in
                    Task {
                        if let created = await model.createSession(groupId: groupId) {
                            openNewlyCreated(created)
                        }
                    }
                },
                onCommandLaunched: { groupId, commandId in
                    // 与普通终端落的是同一屏：在协议上它就是同一个东西 —— 一个终端，
                    // 附带一条启动命令。失败落 banner（见 `performReturningSession`）。
                    Task {
                        if let created = await model.launchCommand(groupId: groupId, commandId: commandId) {
                            openNewlyCreated(created)
                        }
                    }
                },
                onConversationStarted: { sessionId in
                    openNewlyCreated(sessionId)
                }
            )
        }
    }
}

extension View {
    /// 挂上会话创建 sheet。
    ///
    /// - Parameter onOpenCreated: 电脑刚把一个终端交给手机时调用，参数是会话 id。
    func newSessionSheet(
        isPresented: Binding<Bool>,
        onOpenCreated: @escaping (String) -> Void
    ) -> some View {
        modifier(NewSessionSheetModifier(isPresented: isPresented, onOpenCreated: onOpenCreated))
    }
}
