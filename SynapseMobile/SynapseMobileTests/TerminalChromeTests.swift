import Testing

@testable import SynapseMobile

/// 三条栏什么时候可以自己收起来（设计文档 §2）。
///
/// 这一条本来只能在真机上举着手盯三秒看栏有没有跑掉 —— 判定被抽成纯值，就是为了让它
/// 能在这里被逐条走完。每一条禁制都是一个"人正拿着这个东西"的事实，所以每一条都单独
/// 走一遍：七条里漏掉哪一条，症状都是同一种（界面从用户手底下消失），而现场各不相同。
struct TerminalChromeTests {
    /// 什么都归零：人没在操作、屏幕上也没有未了的事。
    private var idle: TerminalChromeConditions { .none }

    @Test func anIdleScreenLetsTheBarsGo() {
        #expect(idle.mayAutoHide)
    }

    /// 系统键盘起来了，或者输入框拿着焦点。
    @Test func typingHoldsTheBars() {
        var conditions = idle
        conditions.isTyping = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 自绘的键盘面板开着。
    ///
    /// 面板一上来，工具栏与输入栏就整条让位（`TerminalScreen.barsStandDown`），所以这条
    /// 禁制管的不再是"别把栏收走"——它们本来就不在屏幕上了。管的是**收栏那个标志**：
    /// 闲置计时器若在面板开着时把 `chromeHidden` 翻真，收掉面板之后人面对的会是一块
    /// 没有栏的屏幕，还得再点一下才知道栏去哪了。
    @Test func theKeyboardPanelHoldsTheBars() {
        var conditions = idle
        conditions.isKeyboardPanelUp = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 正在按住说话。这是产品负责人点名的那一条：手压着的时候界面不能动。
    @Test func aFingerOnTheHoldKeyHoldsTheBars() {
        var conditions = idle
        conditions.isVoiceBusy = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 一块表单或选择器盖在上面。它们挡着栏，所以当场看不出差别 —— 代价在关掉之后：
    /// 人放下重命名面板，看到的是一块没有栏的屏幕。
    @Test func aSheetOverTheScreenHoldsTheBars() {
        var conditions = idle
        conditions.isOverlayUp = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 输入栏上方那张"最新的一张图"还挂着。它也是一条栏，和三条栏存亡与共。
    @Test func theRecentPhotoBubbleHoldsTheBars() {
        var conditions = idle
        conditions.isPhotoBubbleUp = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 收放途中不重新计数 —— 否则一次收栏会被自己的动画拖成两次。
    @Test func settlingHoldsTheBars() {
        var conditions = idle
        conditions.isSettling = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 读屏或切换控制开着。这一条与用户此刻在做什么无关，而正因如此它必须在：
    /// 逐元素浏览的两次触摸之间可以隔很久，而屏幕上的栏正在被一条条念出来。
    @Test func assistiveTechHoldsTheBars() {
        var conditions = idle
        conditions.isAssistiveTechOn = true
        #expect(conditions.mayAutoHide == false)
    }

    /// 一次只解开一条：禁制之间不是"任意一条为真就够"，而是每一条都单独挡得住。
    /// 这条把七个布尔摆在一起再逐格翻回假，任何一个写反了都会在这里露出来。
    @Test func everyBlockingConditionBlocksOnItsOwn() {
        let blocked: [TerminalChromeConditions] = [
            { var c = idle; c.isTyping = true; return c }(),
            { var c = idle; c.isKeyboardPanelUp = true; return c }(),
            { var c = idle; c.isVoiceBusy = true; return c }(),
            { var c = idle; c.isOverlayUp = true; return c }(),
            { var c = idle; c.isPhotoBubbleUp = true; return c }(),
            { var c = idle; c.isSettling = true; return c }(),
            { var c = idle; c.isAssistiveTechOn = true; return c }(),
        ]
        for conditions in blocked {
            #expect(conditions.mayAutoHide == false)
        }
        #expect(blocked.count == 7, "加了一条禁制就要跟着加在这里")
    }
}
