import Testing

@testable import SynapseMobile

/// 一次启动离开起点之后，用户随时可能松手取消、再按一次，或者来电把采集打断。
/// 那些只把界面收回去是不够的：`begin()` 手里还攥着一个马上要打开的麦克风，音频会
/// 一路推到云端，而屏幕上留下的是用户从没要求过的一段录音。
///
/// 触发路径不是构造出来的：按住说话，在权限弹窗或签名往返还没回来时松手，走的就是
/// 这一条 —— `TerminalScreen.settleVoice()` 确认没拿到文本之后会调 `cancel()`。
@MainActor
struct VoiceStartCancellationTests {
    /// 让 `start()` 排下的那个任务有机会跑起来。
    ///
    /// 一次 `Task.yield()` 通常就够（任务是在 `cancel()` 之前排进主 actor 的），多让
    /// 几次是为了不把这条测试绑在调度器的具体实现上。
    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    /// 松手发生在 `begin()` 轮到跑之前。
    ///
    /// 这正是号必须由 `start()` 发、不能由 `begin()` 自己发的理由：自己发的话，它醒来
    /// 时发的号永远是最新的，这道守卫就白设了。
    @Test func aStartCancelledBeforeItRanNeverTouchesTheBar() async {
        let voice = VoiceInputController()
        var signCalls = 0
        voice.start {
            signCalls += 1
            return .notConfigured
        }
        // 手指已经松开，而那次启动还在队列里。
        voice.cancel()
        await settle()

        // 三条一起看，因为「没继续下去」在各种权限状态下长得不一样：已授权会一路走到
        // 签名，被拒会停在权限那一步并留下 `notice`。两个都不是这张测试要的结果 ——
        // 要的是它压根没往下走。
        #expect(voice.phase == .idle)
        #expect(voice.notice == nil)
        #expect(signCalls == 0)
    }
}
